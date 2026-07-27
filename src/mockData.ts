import type { ApplicationSession, CandidateProfile, Job } from "./contracts";

export const demoCandidate: CandidateProfile = {
  id: "candidate-demo",
  fullName: "Alex Morgan",
  email: "alex.morgan@example.com",
  phone: "+1 (925) 555-0142",
  location: "San Francisco, CA",
  currentCompany: "Whitebox Learning",
  currentTitle: "Software Engineer",
  linkedinUrl: "https://linkedin.com/in/alex-morgan",
  portfolioUrl: "https://alexmorgan.dev",
  authorizedToWork: true,
  requiresSponsorship: false,
  resume: { fileName: "Alex_Morgan_Resume.pdf" },
};

export const demoJobs: Job[] = [
  {
    id: "gh-demo-1",
    title: "Senior Software Engineer",
    company: "Northstar Labs",
    location: "San Francisco, CA · Hybrid",
    ats: "greenhouse",
    url: "https://boards.greenhouse.io/example/jobs/10001",
    postedAt: "Today",
    employmentType: "Full-time",
    description: "Build reliable product experiences with a collaborative platform team.",
  },
  {
    id: "lever-demo-1",
    title: "Full Stack Engineer",
    company: "Horizon Systems",
    location: "Remote · United States",
    ats: "lever",
    url: "https://jobs.lever.co/example/00000000-0000-0000-0000-000000000001",
    postedAt: "1 day ago",
    employmentType: "Full-time",
    description: "Own customer-facing workflows across React and Python services.",
  },
  {
    id: "gh-demo-2",
    title: "Machine Learning Engineer",
    company: "Cobalt AI",
    location: "New York, NY · Remote friendly",
    ats: "greenhouse",
    url: "https://job-boards.greenhouse.io/example/jobs/10002",
    postedAt: "2 days ago",
    employmentType: "Full-time",
    description: "Develop production ML systems and the services around them.",
  },
  {
    id: "lever-demo-2",
    title: "Backend Engineer, Platform",
    company: "Signal Works",
    location: "Austin, TX",
    ats: "lever",
    url: "https://jobs.lever.co/example/00000000-0000-0000-0000-000000000002",
    postedAt: "3 days ago",
    employmentType: "Full-time",
    description: "Design APIs, workflows, and observability for our core platform.",
  },
];

export const demoHistory: ApplicationSession[] = [
  {
    id: "application-demo-1",
    job: demoJobs[0],
    status: "submitted",
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 86_100_000).toISOString(),
    detail: "Application confirmed by Greenhouse",
  },
];
