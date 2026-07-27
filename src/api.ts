import type { ApplicationSession, AuthSession, CandidateProfile, Job } from "./contracts";
import { demoCandidate, demoHistory, demoJobs } from "./mockData";
import { detectSupportedAts } from "./ats";

const API_URL = import.meta.env.VITE_WBL_API_URL || "https://api.whitebox-learning.com/api";
const USE_MOCK = import.meta.env.VITE_USE_MOCK_DATA !== "false";
const USE_APPLICATION_API = import.meta.env.VITE_USE_APPLICATION_API === "true";
const TOKEN_KEY = "talentscreen_access_token";
const LOCAL_HISTORY_KEY = "talentscreen_application_history";

interface PaginatedPositions {
  data: Array<Record<string, unknown>>;
  page: number;
  total_pages: number;
}

interface CliWindowPositions {
  data: Array<Record<string, unknown>>;
  total_in_window?: number;
}


function text(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj && typeof obj.$oid === "string") return obj.$oid;
    if (obj && typeof obj.name === "string") return obj.name;
    return fallback;
  }
  return String(value);
}

export function mapWblPosition(row: Record<string, unknown>): Job | null {
  const url = text(row.job_url).trim();
  const ats = detectSupportedAts(url);
  if (!ats) return null;
  // fallback to URL as stable unique ID
  const locationParts = [row.location, row.city, row.state, row.country]
    .map((part) => text(part).trim())
    .filter((part, index, all) => part && all.indexOf(part) === index);
  const positionType = text(row.position_type).replaceAll("_", " ");
  const employmentMode = text(row.employment_mode).replaceAll("_", " ");
  return {
    id: text(row.id || row.source_job_id || row.source_uid || url),
    title: text(row.title || row.normalized_title, "Untitled position"),
    company: text(row.company_name, "Unknown company"),
    location: locationParts.join(" · ") || "Location not provided",
    ats,
    url,
    postedAt: text(row.created_at),
    employmentType: [positionType, employmentMode].filter(Boolean).join(" · "),
    description: text(row.description),
  };
}

function localHistory(): ApplicationSession[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY) || "[]") as ApplicationSession[]; }
  catch { return []; }
}

function saveLocalHistory(rows: ApplicationSession[]) {
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(rows.slice(0, 100)));
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(options.body instanceof URLSearchParams)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {




  async restoreSession(): Promise<AuthSession> {

  const raw = await request<Record<string, unknown>>(
    "/user_dashboard"
  );

  const profile: CandidateProfile = {
    id: String(raw.candidate_id || raw.id),
    fullName: String(raw.full_name || ""),
    email: String(raw.uname || raw.email || ""),
    phone: String(raw.phone || ""),
    location: String(raw.location || "")
  };

  return {
    accessToken: "",
    profile,
  };
},
  useMock: USE_MOCK,

  async login(email: string, password: string): Promise<AuthSession> {
    if (USE_MOCK) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      sessionStorage.setItem(TOKEN_KEY, "demo-token");
      return { accessToken: "demo-token", profile: { ...demoCandidate, email } };
    }
    const body = new URLSearchParams({ username: email, password });
    const token = await request<{ access_token: string }>("/login", { method: "POST", body });
    sessionStorage.setItem(TOKEN_KEY, token.access_token);
    const raw = await request<Record<string, unknown>>("/user_dashboard");
    const profile: CandidateProfile = {
      id: String(raw.candidate_id || raw.id || email),
      fullName: String(raw.full_name || "Candidate"),
      email: String(raw.uname || raw.email || email),
      phone: String(raw.phone || ""),
      location: String(raw.location || ""),
    };
    return { accessToken: token.access_token, profile };
  },

  logout() {
    sessionStorage.removeItem(TOKEN_KEY);
  },

  hasSession() {
    return Boolean(sessionStorage.getItem(TOKEN_KEY));
  },

  async jobs(): Promise<Job[]> {
    if (USE_MOCK) return demoJobs;
    try {
      const cli = await request<CliWindowPositions>("/positions/cli_window?days=7&page_size=5000&offset=0&status=open");
      const recent = cli.data.map(mapWblPosition).filter((job): job is Job => job !== null);
      if (recent.length) return recent;
      // Local/restored database dumps often contain valid open jobs whose
      // created_at values are older than seven days. Fall back to the full
      // open window, while mapWblPosition continues to admit only Greenhouse
      // and Lever URLs.
      const allOpen = await request<CliWindowPositions>(
        "/positions/cli_window?days=0&page_size=5000&offset=0&status=open",
      );
      return allOpen.data.map(mapWblPosition).filter((job): job is Job => job !== null);
    } catch {
      // Production versions predating cli_window return 422 by matching the
      // generic /positions/{id} route. Keep the same fallback as JobCLI.
    }
    const firstPage = await request<PaginatedPositions>("/positions/paginated?page=1&page_size=1500&require_apply_link=true");
    const pages = [firstPage];
    for (let page = 2; page <= firstPage.total_pages; page += 1) {
      pages.push(await request<PaginatedPositions>(`/positions/paginated?page=${page}&page_size=1500&require_apply_link=true`));
    }
    return pages.flatMap((page) => page.data).map(mapWblPosition).filter((job): job is Job => job !== null);
  },

  async history(): Promise<ApplicationSession[]> {
    if (USE_MOCK) return demoHistory;
    if (!USE_APPLICATION_API) return localHistory();
    return request<ApplicationSession[]>("/talentscreen/applications");
  },

  async createApplication(job: Job): Promise<ApplicationSession> {
    if (USE_MOCK) {
      const now = new Date().toISOString();
      return { id: crypto.randomUUID(), job, status: "opening_browser", createdAt: now, updatedAt: now };
    }
    if (!USE_APPLICATION_API) {
      const now = new Date().toISOString();
      const application: ApplicationSession = {
        id: crypto.randomUUID(), job, status: "opening_browser", createdAt: now, updatedAt: now,
        detail: "Created locally; backend application API is disabled",
      };
      saveLocalHistory([application, ...localHistory()]);
      return application;
    }
    return request<ApplicationSession>("/talentscreen/applications", {
      method: "POST",
      body: JSON.stringify({ jobId: job.id, jobUrl: job.url, ats: job.ats }),
    });
  },
};

