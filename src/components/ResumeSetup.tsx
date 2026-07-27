import { useState } from "react";
import { ArrowRight, FileCheck2, UploadCloud, XCircle } from "lucide-react";
import { api } from "../api";
import { automation } from "../automation";
import type { SessionResume } from "../contracts";
import { emptyAnswers, errorMessage, fileAsBase64 } from "../utils/helpers";
import { BoolSelect } from "./BoolSelect";

interface ResumeSetupProps {
  email: string;
  onReady: (resume: SessionResume, name?: string) => void;
}

export function ResumeSetup({ email, onReady }: ResumeSetupProps) {
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [answers, setAnswers] = useState(emptyAnswers);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!jsonFile || !pdfFile) {
      setError("Select both a JSON resume and PDF resume.");
      return;
    }

    setLoading(true);
    setStatusMsg("");
    try {
      const rawJson = JSON.parse(await jsonFile.text()) as Record<string, unknown>;
      if (!(rawJson.basics || rawJson.personal || rawJson.contact_info)) {
        throw new Error("JSON resume must contain basics or personal information.");
      }

      const resume: SessionResume = {
        jsonFileName: jsonFile.name,
        pdfFileName: pdfFile.name,
        rawJson,
        pdfBase64: await fileAsBase64(pdfFile),
        answers,
      };

      if (!api.useMock) {
        await automation.start((msg) => setStatusMsg(msg));
        const result = await automation.setup(resume, email, (msg) => setStatusMsg(msg));
        onReady(resume, result.profile.fullName);
      } else {
        onReady(resume);
      }
    } catch (reason) {
      setError(errorMessage(reason, "Resume setup failed"));
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  }

  return (
    <main className="setup-light-shell">
      <section className="setup-wizard-light">
        <div className="wizard-heading-light">
          <div className="brand-mark">W</div>
          <div>
            <span className="eyebrow blue">STEP 2 OF 2</span>
            <h1>Set up application profile</h1>
            <p>Upload your resume files and set deterministic answers for job applications.</p>
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="upload-grid">
            <label className={`upload-box-light ${jsonFile ? "selected" : ""}`}>
              <UploadCloud />
              <strong>{jsonFile?.name || "Upload JSON resume"}</strong>
              <span>JSON Resume or TalentScreen profile</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => setJsonFile(e.target.files?.[0] || null)}
                required
              />
            </label>

            <label className={`upload-box-light ${pdfFile ? "selected" : ""}`}>
              <FileCheck2 />
              <strong>{pdfFile?.name || "Upload PDF resume"}</strong>
              <span>Attached to supported applications</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                required
              />
            </label>
          </div>

          <div className="answers-panel-light">
            <h2>Reusable application answers</h2>
            <p>Answers are used strictly for deterministic ATS fields without any AI guessing.</p>
            <div className="answer-grid">
              <BoolSelect
                label="Authorized to work in the US?"
                value={answers.authorizedToWork}
                onChange={(v) => setAnswers({ ...answers, authorizedToWork: v })}
              />
              <BoolSelect
                label="Require sponsorship?"
                value={answers.requiresSponsorship}
                onChange={(v) => setAnswers({ ...answers, requiresSponsorship: v })}
              />
              <BoolSelect
                label="Willing to relocate?"
                value={answers.willingToRelocate}
                onChange={(v) => setAnswers({ ...answers, willingToRelocate: v })}
              />
              <BoolSelect
                label="Consent to background check?"
                value={answers.backgroundCheckConsent}
                onChange={(v) => setAnswers({ ...answers, backgroundCheckConsent: v })}
              />

              {/* <label>
                Minimum salary
                <input
                  value={answers.minimumSalary}
                  onChange={(e) => setAnswers({ ...answers, minimumSalary: e.target.value })}
                  placeholder="e.g. $110,000 / year"
                />
              </label>
              <label>
                Security clearance
                <input
                  value={answers.securityClearance}
                  onChange={(e) => setAnswers({ ...answers, securityClearance: e.target.value })}
                  placeholder="None / Secret / TS-SCI"
                />
              </label> */}
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <XCircle size={16} />
              {error}
            </div>
          )}

          <button className="primary-button setup-submit" disabled={loading}>
            {loading ? (
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                <span>Setting up…</span>
                {statusMsg && (
                  <span style={{ fontSize: "0.75rem", opacity: 0.75, fontWeight: 400 }}>{statusMsg}</span>
                )}
              </span>
            ) : (
              <>Continue to jobs <ArrowRight size={17} /></>
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
