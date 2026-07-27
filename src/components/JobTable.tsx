import { ExternalLink, MapPin } from "lucide-react";
import type { Job } from "../contracts";

interface JobTableProps {
  jobs: Job[];
  jobStates: Record<string, string>;
}

export function JobTable({ jobs, jobStates }: JobTableProps) {
  if (!jobs.length) {
    return (
      <div className="table-empty-state">
        <p>No matching positions found in the queue.</p>
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="job-data-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Role Title</th>
            <th>ATS Platform</th>
            <th>Location</th>
            <th>Type</th>
            <th>Status</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const state = jobStates[job.id] || "Ready";
            const isSubmitted = state === "submitted";
            const isFailed = state === "failed" || state === "submission_unconfirmed";
            const isSkipped = state === "skipped";
            const isManual = state === "manual_action_required";

            let statusClass = "status-ready";
            if (isSubmitted) statusClass = "status-submitted";
            if (isFailed) statusClass = "status-failed";
            if (isSkipped) statusClass = "status-skipped";
            if (isManual) statusClass = "status-manual";

            return (
              <tr key={job.id} className="job-table-row">
                <td className="company-col">
                  <div className="company-cell">
                    <div className={`company-logo-sm ${job.ats}`}>
                      {job.company.slice(0, 1)}
                    </div>
                    <strong>{job.company}</strong>
                  </div>
                </td>
                <td className="title-col">
                  <span className="job-title-text">{job.title}</span>
                </td>
                <td className="ats-col">
                  <span className={`ats-badge ${job.ats}`}>{job.ats}</span>
                </td>
                <td className="location-col">
                  <span className="location-cell">
                    <MapPin size={13} />
                    {job.location}
                  </span>
                </td>
                <td className="type-col">
                  <span className="type-badge">{job.employmentType || "Full-time"}</span>
                </td>
                <td className="status-col">
                  <span className={`status-pill ${statusClass}`}>{state}</span>
                </td>
                <td className="action-col">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="table-link-icon"
                    title="View Job Source"
                  >
                    <ExternalLink size={15} />
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
