import { invoke } from "@tauri-apps/api/core";
import type { AutomationEvent, Job, SessionResume } from "./contracts";

const AUTOMATION_URL = "http://127.0.0.1:8765/api";

/** Fetch with a hard timeout so calls never hang forever. */
async function localRequest<T>(path: string, options: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${AUTOMATION_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new Error(
          `Setup timed out after ${timeoutMs / 1000}s. The automation engine is taking too long — please restart the app and try again.`
        );
      }
      // "Failed to fetch" / TypeError means the sidecar is unreachable (not running / crashed)
      if (err.name === "TypeError" || err.message.toLowerCase().includes("fetch")) {
        throw new Error(
          `Cannot connect to the automation engine (port 8765). It may still be starting or has crashed — please restart the app.`
        );
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    let errMsg = "";
    if (Array.isArray(body.detail)) {
      errMsg = body.detail.map((err: any) => {
        const field = err.loc ? err.loc.join(".") : "field";
        const message = err.msg || "unknown validation error";
        return `${field}: ${message}`;
      }).join("; ");
    } else {
      errMsg = body.detail || body.message || `Automation service failed (${response.status})`;
    }
    throw new Error(errMsg);
  }
  return response.json() as Promise<T>;
}

export const automation = {
  async start(onProgress?: (msg: string) => void): Promise<void> {
    let sidecarError: string | null = null;
    onProgress?.("Starting automation engine…");
    try {
      await invoke("start_automation_sidecar");
    } catch (error) {
      const msg = typeof error === "string" ? error : (error as Error)?.message || "Sidecar launch failed";
      sidecarError = msg;
      throw new Error(`Automation engine error: ${msg}`);
    }
    onProgress?.("Waiting for automation engine to be ready…");
    // Poll up to 30 attempts (30 s) with a short per-request timeout
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await localRequest("/status", {}, 3_000);
        onProgress?.("Automation engine is ready.");
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error(
      sidecarError
        ? `Automation engine error: ${sidecarError}`
        : "The automation engine did not start within 30 s. Check %APPDATA%\\.talentscreen_resume\\sidecar.log for details."
    );
  },

  setup(resume: SessionResume, email: string, onProgress?: (msg: string) => void) {
    onProgress?.("Uploading resume and profile data…");
    // 90 s is generous — Python caps the spaCy NER call at 20 s internally
    return localRequest<{ profile: { fullName: string; email: string } }>("/session/setup", {
      method: "POST",
      body: JSON.stringify({ ...resume, email }),
    }, 90_000);
  },

  startBatch(jobs: Job[]) {
    return localRequest<{ runId: string }>("/batch", {
      method: "POST",
      body: JSON.stringify({ jobs }),
    });
  },

  events(cursor = 0) {
    return localRequest<{ events: AutomationEvent[]; cursor: number; running: boolean }>(
      `/events?cursor=${cursor}`, {}, 10_000
    );
  },

  stop() { return localRequest<{ status: string }>("/stop", { method: "POST" }); },
  resume() { return localRequest<{ status: string }>("/manual/resume", { method: "POST" }); },
  skip() { return localRequest<{ status: string }>("/manual/skip", { method: "POST" }); },
  history() { return localRequest<any[]>("/history", { method: "GET" }); },
};

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown; }
}
