import { useState } from "react";
import { Briefcase, CheckCheck, Filter, LayoutGrid, Moon, PauseCircle, Play, Power, Search, SlidersHorizontal, Sun, Table, Wand2, XCircle } from "lucide-react";
import type { AtsType, AutomationEvent, CandidateProfile, Job, SessionResume } from "../contracts";
import { JobCard } from "./JobCard";
import { JobTable } from "./JobTable";
import { Sidebar } from "./Sidebar";

interface JobDashboardProps {
  profile: CandidateProfile;
  resume: SessionResume;
  historyCount: number;
  jobs: Job[];
  filteredJobs: Job[];
  jobStates: Record<string, string>;
  events: AutomationEvent[];
  search: string;
  dark: boolean;
  running: boolean;
  error: string;
  onSearchChange: (query: string) => void;
  onToggleDark: () => void;
  onApplyAll: () => void;
  onStop: () => void;
  onLogout: () => void;
}

export function JobDashboard({
  profile,
  resume,
  historyCount,
  jobs,
  filteredJobs,
  jobStates,
  events,
  search,
  dark,
  running,
  error,
  onSearchChange,
  onToggleDark,
  onApplyAll,
  onStop,
  onLogout,
}: JobDashboardProps) {
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [atsFilter, setAtsFilter] = useState<"all" | AtsType>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showDropdown, setShowDropdown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page when search or filters change
  const [lastFilters, setLastFilters] = useState({ search, atsFilter, statusFilter });
  if (lastFilters.search !== search || lastFilters.atsFilter !== atsFilter || lastFilters.statusFilter !== statusFilter) {
    setLastFilters({ search, atsFilter, statusFilter });
    setCurrentPage(1);
  }

  const avatarInitials = profile.fullName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");

  const submittedCount = Object.values(jobStates).filter((s) => s === "submitted").length;

  const displayedJobs = filteredJobs.filter((job) => {
    if (atsFilter !== "all" && job.ats !== atsFilter) return false;
    if (statusFilter !== "all") {
      const state = jobStates[job.id] || "Ready";
      if (statusFilter === "ready" && state !== "Ready") return false;
      if (statusFilter === "submitted" && state !== "submitted") return false;
      if (statusFilter === "failed" && state !== "failed" && state !== "submission_unconfirmed") return false;
    }
    return true;
  });

  const pageSize = 60;
  const totalPages = Math.ceil(displayedJobs.length / pageSize) || 1;
  const activePage = Math.min(currentPage, totalPages);
  const paginatedJobs = displayedJobs.slice((activePage - 1) * pageSize, activePage * pageSize);

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    const pages = [];
    pages.push(
      <button
        key="prev"
        className="pagination-button"
        disabled={activePage === 1}
        onClick={() => setCurrentPage(activePage - 1)}
      >
        Prev
      </button>
    );

    let startPage = Math.max(1, activePage - 2);
    let endPage = Math.min(totalPages, activePage + 2);

    if (startPage > 1) {
      pages.push(
        <button
          key={1}
          className={`pagination-number ${activePage === 1 ? "active" : ""}`}
          onClick={() => setCurrentPage(1)}
        >
          1
        </button>
      );
      if (startPage > 2) {
        pages.push(<span key="dots-start" className="pagination-dots">...</span>);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <button
          key={i}
          className={`pagination-number ${activePage === i ? "active" : ""}`}
          onClick={() => setCurrentPage(i)}
        >
          {i}
        </button>
      );
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push(<span key="dots-end" className="pagination-dots">...</span>);
      }
      pages.push(
        <button
          key={totalPages}
          className={`pagination-number ${activePage === totalPages ? "active" : ""}`}
          onClick={() => setCurrentPage(totalPages)}
        >
          {totalPages}
        </button>
      );
    }

    pages.push(
      <button
        key="next"
        className="pagination-button"
        disabled={activePage === totalPages}
        onClick={() => setCurrentPage(activePage + 1)}
      >
        Next
      </button>
    );

    return <div className="pagination">{pages}</div>;
  };

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Job dashboard</h1>
            <p>Greenhouse, Lever  automation engine</p>
          </div>
          <div className="top-actions">
            <button className="icon-button" onClick={onToggleDark} title="Toggle theme">
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div 
              className="profile-details-trigger" 
              onClick={() => setShowDropdown(!showDropdown)}
              title="Profile details"
            >
              <div className="avatar">{avatarInitials}</div>
              <div className="user-name">
                <strong>{profile.fullName}</strong>
                <span>{resume.pdfFileName}</span>
              </div>
              {showDropdown && (
                <div className="profile-dropdown" onClick={(e) => e.stopPropagation()}>
                  <button className="logout-menu-item" onClick={onLogout}>
                    <Power size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="content">
          {error && (
            <div className="error-banner">
              <XCircle size={18} />
              {error}
            </div>
          )}

          <section className="welcome-banner">
            <div>
              <span className="eyebrow">AUTOMATED JOB APPLICATIONS</span>
              <h2>{jobs.length} supported jobs ready</h2>
              <p>
                One batch launches a private Chromium session and processes each supported ATS position without an extension or LLM.
              </p>
            </div>
            <div className="batch-actions">
              {running ? (
                <button className="secondary-action" onClick={onStop}>
                  <PauseCircle size={18} />
                  Stop safely
                </button>
              ) : (
                <button className="batch-button" onClick={onApplyAll} disabled={!displayedJobs.length}>
                  <Play size={18} />
                  Apply to all {displayedJobs.length}
                </button>
              )}
            </div>
          </section>

          <section className="metrics">
            <div>
              <span className="metric-icon blue">
                <Briefcase size={22} />
              </span>
              <p>
                Supported jobs<strong>{jobs.length}</strong>
              </p>
            </div>
            <div>
              <span className="metric-icon green">
                <CheckCheck size={22} />
              </span>
              <p>
                Finished this run<strong>{submittedCount}</strong>
              </p>
            </div>
            <div>
              <span className="metric-icon purple">
                <Wand2 size={22} />
              </span>
              <p>
                Automation<strong>{running ? "Running" : "Ready"}</strong>
              </p>
            </div>
          </section>

          {events.length > 0 && (
            <section className="automation-feed">
              <h3>Live automation</h3>
              {events.slice(-4).map((e, i) => (
                <p key={`${e.timestamp}-${i}`}>
                  <span>{e.type}</span>
                  {e.message}
                </p>
              ))}
            </section>
          )}

          <section className="jobs-section">
            <div className="section-heading">
              <div>
                <h2>Application queue</h2>
                <p>Filter positions by ATS provider, title, location, or application status.</p>
              </div>

              <div className="heading-controls">
                {/* Filtration Controls */}
                <div className="filter-group">
                  <span className="filter-label">
                    <SlidersHorizontal size={14} /> Filter:
                  </span>
                  <select
                    className="filter-select"
                    value={atsFilter}
                    onChange={(e) => setAtsFilter(e.target.value as "all" | AtsType)}
                  >
                    <option value="all">All Platforms</option>
                    <option value="greenhouse">Greenhouse</option>
                    <option value="lever">Lever</option>
                    <option value="ashby">Ashby</option>
                  </select>

                  <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All Statuses</option>
                    <option value="ready">Ready</option>
                    <option value="submitted">Submitted</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                <div className="view-toggle">
                  <button
                    className={viewMode === "table" ? "active" : ""}
                    onClick={() => setViewMode("table")}
                    title="Table View"
                  >
                    <Table size={16} /> Table
                  </button>
                  <button
                    className={viewMode === "grid" ? "active" : ""}
                    onClick={() => setViewMode("grid")}
                    title="Grid View"
                  >
                    <LayoutGrid size={16} /> Cards
                  </button>
                </div>

                <div className="search">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search jobs or companies"
                  />
                </div>
              </div>
            </div>

            {viewMode === "table" ? (
              <JobTable jobs={paginatedJobs} jobStates={jobStates} />
            ) : (
              <div className="job-grid">
                {paginatedJobs.map((job) => (
                  <JobCard key={job.id} job={job} state={jobStates[job.id]} />
                ))}
              </div>
            )}

            {renderPagination()}
          </section>
        </div>
      </main>
    </div>
  );
}
