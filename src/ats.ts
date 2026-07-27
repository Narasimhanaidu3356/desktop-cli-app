import type { AtsType } from "./contracts";

export function detectSupportedAts(url: string): AtsType | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const href = parsed.href.toLowerCase();

    if (
      host === "boards.greenhouse.io" ||
      host === "job-boards.greenhouse.io" ||
      host === "greenhouse.io" ||
      host.endsWith(".greenhouse.io") ||
      href.includes("gh_jid")
    ) {
      return "greenhouse";
    }

    if (host === "jobs.lever.co" || host === "lever.co" || host.endsWith(".lever.co")) {
      return "lever";
    }

    return null;
  } catch {
    return null;
  }
}
