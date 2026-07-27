import { PauseCircle, Play, XCircle } from "lucide-react";
import type { Job } from "../contracts";

interface ManualActionViewProps {
  pausedJob?: Job;
  error: string;
  onResume: () => void;
  onSkip: () => void;
  onStop: () => void;
}

export function ManualActionView({
  pausedJob,
  error,
  onResume,
  onSkip,
  onStop,
}: ManualActionViewProps) {
  return (
    <main className="manual-shell">
      <section className="manual-card">
        <span className="manual-icon">
          <PauseCircle />
        </span>
        <span className="eyebrow blue">MANUAL ACTION REQUIRED</span>
        <h1>Complete the current application</h1>
        <p>
          Playwright has paused on <strong>{pausedJob?.company || "the current company"}</strong>
          {pausedJob?.title ? ` — ${pausedJob.title}` : ""}. Fill any remaining fields or CAPTCHA in the open browser. Submit it manually if needed, then return here.
        </p>

        {error && (
          <div className="error-banner">
            <XCircle size={16} />
            {error}
          </div>
        )}

        <div className="manual-actions">
          <button className="primary-button" onClick={onResume}>
            <Play />
            Resume automation
          </button>
          <button className="manual-skip" onClick={onSkip}>
            Skip this job
          </button>
          <button className="manual-stop" onClick={onStop}>
            Stop entire batch
          </button>
        </div>

        <small>
          Resume verifies ATS confirmation before moving to the next job. It pauses again if the application is still incomplete.
        </small>
      </section>
    </main>
  );
}
