import { describe, expect, it } from "vitest";
import { detectSupportedAts } from "./ats";

describe("detectSupportedAts", () => {
  it("detects Greenhouse hosts", () => {
    expect(detectSupportedAts("https://boards.greenhouse.io/acme/jobs/1")).toBe("greenhouse");
    expect(detectSupportedAts("https://job-boards.greenhouse.io/acme/jobs/1")).toBe("greenhouse");
  });

  it("detects Lever hosts", () => {
    expect(detectSupportedAts("https://jobs.lever.co/acme/abc")).toBe("lever");
  });

  it("does not accept lookalike or unsupported URLs", () => {
    expect(detectSupportedAts("https://greenhouse.io.example.com/job/1")).toBeNull();
    expect(detectSupportedAts("https://example.com/job/1")).toBeNull();
    expect(detectSupportedAts("not-a-url")).toBeNull();
  });
});
