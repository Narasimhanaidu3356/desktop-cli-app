import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { automation } from "./automation";
import { JobDashboard } from "./components/JobDashboard";
import { Login } from "./components/Login";
import { ManualActionView } from "./components/ManualActionView";
import { ResultsView } from "./components/ResultsView";
import { ResumeSetup } from "./components/ResumeSetup";
import type { ApplicationSession, AuthSession, AutomationEvent, Job, SessionResume } from "./contracts";
import { errorMessage } from "./utils/helpers";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [resume, setResume] = useState<SessionResume | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [history, setHistory] = useState<ApplicationSession[]>([]);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AutomationEvent[]>([]);
  const [jobStates, setJobStates] = useState<Record<string, string>>({});
  const [currentBatchIds, setCurrentBatchIds] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<"dashboard" | "history">("dashboard");
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState("");
  const cursor = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  const reloadHistory = () => {
    if (session && resume) {
      api.history().then(setHistory).catch(() => setHistory([]));
    }
  };

  useEffect(() => {
    if (session && resume) {
      api.jobs().then(setJobs).catch((e) => setError(e.message));
      reloadHistory();
    }
  }, [session, resume]);

  // Load stored job states when the user session changes
  useEffect(() => {
    if (session) {
      try {
        const stored = localStorage.getItem(`talentscreen_job_states_${session.profile.email}`);
        if (stored) {
          setJobStates(JSON.parse(stored));
        } else {
          setJobStates({});
        }
      } catch (e) {
        console.error("Failed to load stored job states", e);
      }
    } else {
      setJobStates({});
    }
  }, [session]);

  // Persist job states to localStorage whenever they change
  useEffect(() => {
    if (session) {
      localStorage.setItem(`talentscreen_job_states_${session.profile.email}`, JSON.stringify(jobStates));
    }
  }, [jobStates, session]);

  // Refresh history automatically when switching to the history tab
  useEffect(() => {
    if (currentView === "history") {
      reloadHistory();
    }
  }, [currentView]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const result = await automation.events(cursor.current);
        cursor.current = result.cursor;
        setEvents((old) => [...old, ...result.events].slice(-100));
        for (const event of result.events) {
          if (event.jobId && event.status) {
            const visibleStatus = event.status === "submission_confirmed" ? "submitted" : event.status;
            setJobStates((old) => ({ ...old, [event.jobId!]: visibleStatus }));
          }
        }
        if (!result.running) {
          setRunning(false);
          setShowResults(true);
          reloadHistory(); // Refresh history log on run completion
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lost automation connection");
        setRunning(false);
        setShowResults(true);
      }
    }, 700);
    return () => clearInterval(timer);
  }, [running]);

  const filtered = useMemo(
    () =>
      jobs.filter((j) =>
        `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(search.toLowerCase())
      ),
    [jobs, search]
  );

  const pausedJobId = Object.keys(jobStates).find((id) => jobStates[id] === "manual_action_required");

  async function applyAll() {
    setError("");
    setShowResults(false);
    const ids = filtered.map((j) => j.id);
    setCurrentBatchIds(ids);
    setJobStates((old) => {
      const updated = { ...old };
      for (const id of ids) {
        updated[id] = "opening_browser";
      }
      return updated;
    });
    setEvents([]);
    cursor.current = 0;
    try {
      // Sidecar is already running from the ResumeSetup step — no need to start again.
      // startBatch will fail with a clear error if it has crashed.
      await automation.startBatch(filtered);
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start automation");
    }
  }

  async function stop() {
    const activeJob = pausedJobId;
    await automation.stop().catch(() => undefined);
    if (activeJob) setJobStates((old) => ({ ...old, [activeJob]: "stopped" }));
    setEvents((old) => [
      ...old,
      {
        type: "status",
        status: "stopped",
        message: "Batch stopped by the candidate.",
        timestamp: new Date().toISOString(),
      },
    ]);
    setRunning(false);
    setShowResults(true);
    reloadHistory();
  }

  async function resumeAutomation() {
    setError("");
    try {
      await automation.resume();
    } catch (e) {
      setError(errorMessage(e, "Unable to resume automation"));
    }
  }

  async function skip() {
    setError("");
    try {
      await automation.skip();
    } catch (e) {
      setError(errorMessage(e, "Unable to skip application"));
    }
  }

  function handleLogout() {
    api.logout();
    setResume(null);
    setSession(null);
  }

  if (!session) {
    return <Login onLogin={setSession} />;
  }

  if (!resume) {
    return (
      <ResumeSetup
        email={session.profile.email}
        onReady={(value, name) => {
          setResume(value);
          if (name) {
            setSession({
              ...session,
              profile: { ...session.profile, fullName: session.profile.fullName || name, resume: { fileName: value.pdfFileName } },
            });
          }
        }}
      />
    );
  }

  if (showResults) {
    return (
      <ResultsView
        jobs={jobs.filter((j) => currentBatchIds.includes(j.id))}
        jobStates={Object.fromEntries(
          Object.entries(jobStates).filter(([id]) => currentBatchIds.includes(id))
        )}
        events={events}
        onBack={() => setShowResults(false)}
      />
    );
  }

  if (pausedJobId) {
    const pausedJob = jobs.find((job) => job.id === pausedJobId);
    return (
      <ManualActionView
        pausedJob={pausedJob}
        error={error}
        onResume={resumeAutomation}
        onSkip={skip}
        onStop={stop}
      />
    );
  }

  return (
    <JobDashboard
      profile={session.profile}
      resume={resume}
      historyCount={history.length}
      jobs={jobs}
      filteredJobs={filtered}
      jobStates={jobStates}
      events={events}
      search={search}
      dark={dark}
      running={running}
      error={error}
      onSearchChange={setSearch}
      onToggleDark={() => setDark(!dark)}
      onApplyAll={applyAll}
      onStop={stop}
      onLogout={handleLogout}
      currentView={currentView}
      onViewChange={setCurrentView}
      history={history}
    />
  );
}
