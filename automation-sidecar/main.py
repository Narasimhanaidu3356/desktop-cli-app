"""Loopback-only Playwright automation service for TalentScreen Apply.

The service is intentionally standalone: it contains no JobCLI, extension, or
LLM imports. Resume files live only in the session directory supplied by Tauri.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import concurrent.futures
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from talentscreen_automation.browser import AutomationCancelled, ManualGate, run_jobs
from talentscreen_automation.profile import CandidateProfile, normalize_profile
from talentscreen_automation.gender_detector import detect_gender_from_name


def configure_playwright_env() -> None:
    """Configure Playwright environment variables for both frozen (PyInstaller)
    and source-run modes so the sidecar works on any machine without requiring
    a separate Playwright installation.
    """
    # ── 1. Playwright driver (node.exe + CLI) ──────────────────────────────
    # When frozen by PyInstaller, the playwright package is extracted under
    # sys._MEIPASS.  We point PLAYWRIGHT_NODEJS_PATH at the bundled node.exe
    # so Playwright never tries to locate one in PATH.
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        node_bin = "node.exe" if os.name == "nt" else "node"
        bundled_node = Path(meipass) / "playwright" / "driver" / node_bin
        if bundled_node.is_file() and not os.getenv("PLAYWRIGHT_NODEJS_PATH"):
            os.environ["PLAYWRIGHT_NODEJS_PATH"] = str(bundled_node)

    # ── 2. Browsers path ───────────────────────────────────────────────────
    # Skip if the caller already set a valid path.
    current = os.getenv("PLAYWRIGHT_BROWSERS_PATH")
    if current and Path(current).is_dir():
        return

    # Build a prioritised candidate list so we find the bundled browsers
    # regardless of whether we are running from source or as a frozen exe.
    candidates: list[Path] = []

    if meipass:
        candidates += [
            Path(meipass) / "browsers",
        ]

    candidates += [
        # Next to the executable (frozen or source-run)
        Path(sys.executable).resolve().parent / "browsers",
        Path(sys.executable).resolve().parent.parent / "browsers",
        # Next to main.py (source-run dev mode)
        Path(__file__).resolve().parent / "browsers",
        Path(__file__).resolve().parent.parent / "browsers",
        # Tauri resource layouts (installed app)
        Path(sys.executable).resolve().parent.parent / "_up_" / "automation-sidecar" / "browsers",
        Path(sys.executable).resolve().parent.parent.parent / "_up_" / "automation-sidecar" / "browsers",
    ]

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            if resolved.is_dir():
                os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(resolved)
                return
        except OSError:
            continue


configure_playwright_env()


def monitor_parent_process() -> None:
    try:
        sys.stdin.read()
    except Exception:
        pass
    os._exit(0)


threading.Thread(target=monitor_parent_process, daemon=True).start()


def get_secure_resume_dir() -> Path:
    appdata = os.getenv("APPDATA") or os.getenv("LOCALAPPDATA")
    if appdata:
        base = Path(appdata) / ".talentscreen_resume"
    else:
        base = Path.home() / ".talentscreen_resume"
    base.mkdir(parents=True, exist_ok=True)
    return base


SESSION_DIR = Path(os.getenv("TALENTSCREEN_SESSION_DIR") or get_secure_resume_dir())
SESSION_DIR.mkdir(parents=True, exist_ok=True)
PROFILE_PATH = SESSION_DIR / "profile.json"
PDF_PATH = SESSION_DIR / "resume.pdf"
HISTORY_PATH = SESSION_DIR / "history.json"
if not HISTORY_PATH.exists():
    try:
        HISTORY_PATH.write_text("[]", encoding="utf-8")
    except Exception:
        pass

app = FastAPI(title="TalentScreen Local Automation", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_events: list[dict[str, Any]] = []
_running = False
_lock = threading.Lock()
_stop = threading.Event()
_manual_gate = ManualGate()
_active_jobs: dict[str, dict[str, Any]] = {}


def _write_history_entry(job_id: str, status: str) -> None:
    global _active_jobs
    job = _active_jobs.get(job_id)
    if not job:
        return
    
    history_path = SESSION_DIR / "history.json"
    history = []
    if history_path.exists():
        try:
            history = json.loads(history_path.read_text(encoding="utf-8"))
        except Exception:
            history = []
            
    final_status = "submitted" if status == "submission_confirmed" else status
    
    # Check if this job is already in history, if so update it, otherwise append
    found = False
    for entry in history:
        if entry.get("id") == job_id:
            entry["status"] = final_status
            entry["timestamp"] = datetime.now(timezone.utc).isoformat()
            found = True
            break
            
    if not found:
        history.append({
            "id": job_id,
            "title": job.get("title", ""),
            "company": job.get("company", ""),
            "location": job.get("location", ""),
            "ats": job.get("ats", ""),
            "url": job.get("url", ""),
            "status": final_status,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
    try:
        history_path.write_text(json.dumps(history, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"Failed to write history: {exc}")


def emit(event_type: str, message: str, **extra: Any) -> None:
    with _lock:
        _events.append({"type": event_type, "message": message,
                        "timestamp": datetime.now(timezone.utc).isoformat(), **extra})
    
    # Persistent history recording on terminal job statuses
    job_id = extra.get("jobId")
    status = extra.get("status")
    if job_id and status in ("submission_confirmed", "skipped", "failed", "stopped"):
        _write_history_entry(job_id, status)


class Answers(BaseModel):
    authorizedToWork: bool | None = None
    requiresSponsorship: bool | None = None
    willingToRelocate: bool | None = None
    backgroundCheckConsent: bool | None = None
    minimumSalary: str = ""
    citizenship: str = ""
    securityClearance: str = ""
   


class SetupRequest(BaseModel):
    jsonFileName: str
    pdfFileName: str
    rawJson: dict[str, Any]
    pdfBase64: str
    answers: Answers
    email: str


class JobPayload(BaseModel):
    id: str
    title: str
    company: str
    location: str
    ats: Literal["greenhouse", "lever"]
    url: str
    description: str | None = None


class BatchRequest(BaseModel):
    jobs: list[JobPayload] = Field(min_length=1)


@app.get("/api/status")
def status() -> dict[str, Any]:
    return {"status": "online", "configured": PROFILE_PATH.exists() and PDF_PATH.exists(), "running": _running}


@app.post("/api/session/setup")
def setup_session(payload: SetupRequest) -> dict[str, Any]:
    try:
        # macOS may clean an empty temporary directory between sidecar startup
        # and the candidate completing the upload form. Recreate it at the
        # moment files are persisted instead of assuming it still exists.
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        pdf = base64.b64decode(payload.pdfBase64, validate=True)
        if not pdf.startswith(b"%PDF"):
            raise ValueError("uploaded resume is not a valid PDF")
        profile = normalize_profile(payload.rawJson, payload.answers.model_dump(), payload.email)
        PDF_PATH.write_bytes(pdf)

        # ────────────────────────────────────────────────────────────────────

        PROFILE_PATH.write_text(profile.model_dump_json(), encoding="utf-8")
        if not PDF_PATH.is_file() or not PROFILE_PATH.is_file():
            raise OSError("session resume files could not be persisted")
        emit("status", "Resume and deterministic answers are ready.", status="ready")
        return {"profile": {"fullName": profile.full_name or "Candidate", "email": profile.email}}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Resume setup failed: {exc}") from exc


def _run_batch(run_id: str, jobs: list[JobPayload]) -> None:
    global _running
    try:
        profile = CandidateProfile.model_validate_json(PROFILE_PATH.read_text(encoding="utf-8"))
        run_jobs([item.model_dump() for item in jobs], profile, PDF_PATH, emit, _stop, _manual_gate)
        emit("complete", "Batch application run finished.", status="stopped" if _stop.is_set() else "idle")
    except AutomationCancelled:
        emit("complete", "Application run stopped safely.", status="stopped")
    except Exception as exc:
        emit("error", f"Automation failed: {exc}", status="failed")
    finally:
        _running = False


@app.post("/api/batch")
def start_batch(payload: BatchRequest) -> dict[str, str]:
    global _running, _active_jobs
    if _running:
        raise HTTPException(status_code=409, detail="An automation run is already active")
    if not PROFILE_PATH.exists() or not PDF_PATH.exists():
        raise HTTPException(status_code=412, detail="Upload a JSON and PDF resume first")
    with _lock:
        _events.clear()
        _active_jobs = {job.id: job.model_dump() for job in payload.jobs}
    _stop.clear()
    _running = True
    run_id = str(uuid.uuid4())
    threading.Thread(target=_run_batch, args=(run_id, payload.jobs), daemon=True).start()
    emit("status", f"Started {len(payload.jobs)} supported jobs.", status="running")
    return {"runId": run_id}


@app.get("/api/events")
def events(cursor: int = 0) -> dict[str, Any]:
    with _lock:
        rows = _events[max(0, cursor):]
        next_cursor = len(_events)
    return {"events": rows, "cursor": next_cursor, "running": _running}


@app.get("/api/history")
def get_history() -> list[dict[str, Any]]:
    history_path = SESSION_DIR / "history.json"
    if not history_path.exists():
        return []
    try:
        return json.loads(history_path.read_text(encoding="utf-8"))
    except Exception:
        return []


@app.post("/api/stop")
def stop() -> dict[str, str]:
    job_id = _manual_gate.job_id
    _stop.set()
    if job_id:
        emit("job", "Stopped by the candidate before submission confirmation.",
             jobId=job_id, status="stopped")
    emit("status", "Stop requested. Returning to the run summary.", status="stopped")
    return {"status": "stopping"}


@app.post("/api/manual/resume")
def resume_manual_action() -> dict[str, str]:
    job_id = _manual_gate.job_id
    if not _manual_gate.signal_resume():
        raise HTTPException(status_code=409, detail="No application is waiting for manual action")
    emit("status", "Checking the manually completed application.",
         jobId=job_id, status="validating")
    return {"status": "resuming"}


@app.post("/api/manual/skip")
def skip_manual_action() -> dict[str, str]:
    if not _manual_gate.signal_skip():
        raise HTTPException(status_code=409, detail="No application is waiting for manual action")
    return {"status": "skipping"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
