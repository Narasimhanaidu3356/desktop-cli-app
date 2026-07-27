import type { ApplicationAnswers } from "../contracts";

export const emptyAnswers: ApplicationAnswers = {
  authorizedToWork: null,
  requiresSponsorship: null,
  willingToRelocate: null,
  backgroundCheckConsent: null,
  minimumSalary: "",
  citizenship: "",
  securityClearance: "",
   
 
};

export function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return fallback;
}

export async function fileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
