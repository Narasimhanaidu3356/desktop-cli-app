export type AtsType = "greenhouse" | "lever";
export type ApplicationStatus =
  | "ready"
  | "opening_browser"
  | "waiting_for_extension"
  | "filling"
  | "validating"
  | "submitting"
  | "submitted"
  | "manual_action_required"
  | "submission_confirmed"
  | "submission_unconfirmed"
  | "skipped"
  | "stopped"
  | "failed"
  | "unsupported_question"
  | "captcha_detected";

export interface CandidateProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  currentCompany?: string;
  currentTitle?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  authorizedToWork?: boolean;
  requiresSponsorship?: boolean;
  resume?: { fileName: string; downloadUrl?: string };
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  ats: AtsType;
  url: string;
  postedAt?: string;
  employmentType?: string;
  description?: string;
}

export interface ApplicationSession {
  id: string;
  job: Job;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  detail?: string;
}

export interface AuthSession {
  accessToken: string;
  profile: CandidateProfile;
}

export interface SessionResume {
  jsonFileName: string;
  pdfFileName: string;
  rawJson: Record<string, unknown>;
  pdfBase64: string;
  answers: ApplicationAnswers;
}

export interface ApplicationAnswers {
  authorizedToWork: boolean | null;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
  backgroundCheckConsent: boolean | null;
  minimumSalary: string;
  citizenship: string;
  securityClearance: string;

}

export interface AutomationEvent {
  type: "status" | "job" | "log" | "error" | "complete";
  status?: ApplicationStatus | "idle" | "running" | "stopped";
  jobId?: string;
  message: string;
  timestamp: string;
}

export type JobRunStatus = "pending" | "applying" | "applied" | "failed" | "skipped";

