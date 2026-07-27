import { MapPin } from "lucide-react";
import type { Job } from "../contracts";

interface JobCardProps {
  job: Job;
  state?: string;
}

export function JobCard({ job, state }: JobCardProps) {
  return (
    <article className="job-card">
      <div className="job-card-top">
        <div className={`company-logo ${job.ats}`}>{job.company.slice(0, 1)}</div>
        <span className={`ats-badge ${job.ats}`}>{job.ats}</span>
      </div>

      <div className="job-main">
        <h3>{job.title}</h3>
        <p className="company-name">{job.company}</p>
        <p className="job-location">
          <MapPin size={14} />
          {job.location}
        </p>
      </div>

      <p className="job-description">{job.description}</p>

      <div className="job-meta">
        <span>{job.employmentType}</span>
        <span>•</span>
        <span>{state || "Ready"}</span>
      </div>
    </article>
  );
}
