import type { AutomationEvent, Job } from "../contracts";

interface ResultsViewProps {
  jobs: Job[];
  jobStates: Record<string, string>;
  events: AutomationEvent[];
  onBack: () => void;
}

export function ResultsView({ jobs, jobStates, events, onBack }: ResultsViewProps) {
  const submitted = Object.values(jobStates).filter((v) => v === "submitted").length;
  const skipped = Object.values(jobStates).filter((v) => v === "skipped").length;
  const failed = Object.values(jobStates).filter(
    (v) => v === "failed" || v === "submission_unconfirmed"
  ).length;
  const stopped = Object.values(jobStates).filter((v) => v === "stopped").length;

  return (
    <main className="results-shell">
      <section className="results-card">
        <span className="eyebrow blue">RUN SUMMARY</span>
        <h1>Application results</h1>
        <p>Only ATS confirmation pages are counted as successful submissions.</p>

        <div className="result-counts">
          <div className="success">
            <strong>{submitted}</strong>
            <span>Submitted</span>
          </div>
          <div>
            <strong>{skipped}</strong>
            <span>Skipped</span>
          </div>
          <div className="danger">
            <strong>{failed}</strong>
            <span>Failed / unconfirmed</span>
          </div>
          <div>
            <strong>{stopped}</strong>
            <span>Stopped</span>
          </div>
        </div>

        <div className="result-list">
          {jobs
            .filter((job) => jobStates[job.id])
            .map((job) => (
              <div key={job.id}>
                <span>
                  <strong>{job.title}</strong>
                  <small>{job.company}</small>
                </span>
                <b className={`result-status ${jobStates[job.id]}`}>{jobStates[job.id]}</b>
              </div>
            ))}
        </div>

        {/* {events.length > 0 && (
          <div className="result-log">
            <h2>Run log</h2>
            {events.slice(-12).map((event, index) => (
              <p key={`${event.timestamp}-${index}`}>
                <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                {event.message}
              </p>
            ))}
          </div>
        )} */}

        <button className="primary-button results-back" onClick={onBack}>
          Back to job dashboard
        </button>
      </section>
    </main>
  );
}
