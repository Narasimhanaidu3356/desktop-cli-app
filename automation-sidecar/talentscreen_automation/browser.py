from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from playwright.sync_api import Browser, FrameLocator, Locator, Page, TimeoutError as PlaywrightTimeout, sync_playwright

from .profile import CandidateProfile
from .rules import answer_for, best_option, normalize
from .ats_greenhouse import fill_greenhouse, is_greenhouse_url
from .ats_lever import fill_lever, is_lever_url


Emit = Callable[..., None]


class AutomationCancelled(Exception):
    pass


class ManualGate:
    """Thread-safe bridge between dashboard controls and the active page."""

    def __init__(self) -> None:
        self.resume = threading.Event()
        self.skip = threading.Event()
        self._lock = threading.Lock()
        self.job_id: str | None = None

    def begin(self, job_id: str) -> None:
        with self._lock:
            self.job_id = job_id
            self.resume.clear()
            self.skip.clear()

    def finish(self) -> None:
        with self._lock:
            self.job_id = None
            self.resume.clear()
            self.skip.clear()

    def signal_resume(self) -> bool:
        with self._lock:
            if self.job_id is None:
                return False
            self.resume.set()
            return True

    def signal_skip(self) -> bool:
        with self._lock:
            if self.job_id is None:
                return False
            self.skip.set()
            return True


LABEL_SCRIPT = """el => {
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const labelled = (el.getAttribute('aria-labelledby') || '').split(/\\s+/)
    .map(id => document.getElementById(id)?.innerText || '').join(' ');
  const explicit = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
  const wrapping = el.closest('label')?.innerText || '';
  const group = el.closest('fieldset, [role="group"], [data-qa*="question"], .field, .application-question');
  const groupLabel = group?.querySelector('legend, label, [class*="label"], [class*="question"]')?.innerText || '';
  const previous = el.parentElement?.querySelector(':scope > label, :scope > legend')?.innerText || '';
  return clean(labelled || el.getAttribute('aria-label') || explicit || groupLabel || previous || wrapping ||
    el.getAttribute('placeholder') || el.getAttribute('name') || '');
}"""


def _label(control: Locator) -> str:
    try:
        return control.evaluate(LABEL_SCRIPT)
    except Exception:
        return ""


def _visible(control: Locator) -> bool:
    try:
        return control.is_visible() and control.is_enabled()
    except Exception:
        return False


def _dispatch(control: Locator) -> None:
    control.evaluate("el => { el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); }")


def _fill_text(control: Locator, value: str) -> bool:
    try:
        if control.input_value().strip():
            return False
        control.fill(value)
        _dispatch(control)
        return True
    except Exception:
        return False


def _fill_select(control: Locator, answer: str) -> bool:
    try:
        options = control.locator("option").all_text_contents()
        choice = best_option(answer, options)
        if not choice:
            return False
        control.select_option(label=choice)
        _dispatch(control)
        return True
    except Exception:
        return False


def _fill_radio(control: Locator, answer: str) -> bool:
    try:
        name = control.get_attribute("name")
        scope = control.locator("xpath=ancestor::*[self::fieldset or @role='group'][1]")
        candidates = scope.locator("input[type=radio]") if scope.count() else control.page.locator(f'input[type="radio"][name="{name}"]')
        options: list[tuple[Locator, str]] = []
        for index in range(candidates.count()):
            candidate = candidates.nth(index)
            text = _label(candidate) or candidate.get_attribute("value") or ""
            options.append((candidate, text))
        choice = best_option(answer, [text for _, text in options])
        for candidate, text in options:
            if choice == text:
                candidate.check(force=True)
                _dispatch(candidate)
                return True
    except Exception:
        pass
    return False


def _fill_custom_select(control: Locator, answer: str) -> bool:
    try:
        control.click()
        control.page.wait_for_timeout(150)
        options = control.page.locator('[role="option"]:visible, [role="listbox"] li:visible')
        texts = options.all_text_contents()
        choice = best_option(answer, texts)
        if not choice:
            control.press("Escape")
            return False
        for index, text in enumerate(texts):
            if text == choice:
                options.nth(index).click()
                return True
    except Exception:
        try:
            control.press("Escape")
        except Exception:
            pass
    return False


def _get_target_context(page: Page, ats_type: str | None) -> Page | FrameLocator:
    """Return the FrameLocator if the ATS form is embedded in an iframe, otherwise page."""
    if ats_type == "greenhouse":
        iframe = page.locator('iframe[src*="greenhouse.io"], iframe#grnhse_iframe').first
        if iframe.count() and iframe.is_visible():
            return page.frame_locator('iframe[src*="greenhouse.io"], iframe#grnhse_iframe')
    elif ats_type == "lever":
        iframe = page.locator('iframe[src*="lever.co"], iframe#lever_iframe').first
        if iframe.count() and iframe.is_visible():
            return page.frame_locator('iframe[src*="lever.co"], iframe#lever_iframe')
    return page


def _resume_is_attached(container: Page | FrameLocator, resume_path: Path | None = None) -> bool:
    inputs = container.locator('input[type="file"]')
    for index in range(inputs.count()):
        try:
            if inputs.nth(index).evaluate("el => Boolean(el.files && el.files.length)"):
                return True
        except Exception:
            continue
    if resume_path is not None:
        try:
            filename = container.get_by_text(resume_path.name, exact=False)
            upload_error = container.get_by_text(re.compile(r"uploadFile|upload failed|could not upload", re.I))
            if filename.count() and not any(
                upload_error.nth(index).is_visible() for index in range(upload_error.count())
            ):
                return True
        except Exception:
            pass
    return False


def _attach_resume(page: Page, container: Page | FrameLocator, resume_path: Path, emit: Emit, job_id: str) -> bool:
    """Upload through the ATS widget first so its framework state is initialized."""
    if _resume_is_attached(container, resume_path):
        return False

    # For Greenhouse URLs, we skip the button triggers completely to avoid JavaScript upload crashes
    if not is_greenhouse_url(page.url):
        triggers = container.get_by_role(
            "button", name=re.compile(r"^(attach|upload( resume| cv)?|choose file|browse)$", re.I)
        ).or_(container.get_by_text(re.compile(r"^(attach|upload( resume| cv)?|choose file|browse)$", re.I)))
        for index in range(triggers.count()):
            trigger = triggers.nth(index)
            try:
                if not trigger.is_visible() or not trigger.is_enabled():
                    continue
                context = normalize(_label(trigger) + " " + trigger.inner_text())
                if "cover letter" in context or "dropbox" in context or "manually" in context:
                    continue
                with page.expect_file_chooser(timeout=2500) as chooser:
                    trigger.click()
                chooser.value.set_files(str(resume_path))
                page.wait_for_timeout(1000)
                if _resume_is_attached(container, resume_path):
                    emit("log", "Attached the PDF resume through the ATS upload control.",
                         jobId=job_id, status="filling")
                    return True
            except Exception:
                continue

    # Fallback for conventional/hidden inputs used by Lever and older forms.
    file_inputs = container.locator('input[type="file"]')
    for index in range(file_inputs.count()):
        control = file_inputs.nth(index)
        try:
            already_attached = control.evaluate("el => Boolean(el.files && el.files.length)")
            if already_attached:
                continue
            identity = normalize(" ".join(filter(None, [
                _label(control),
                control.get_attribute("id"),
                control.get_attribute("name"),
                control.get_attribute("aria-label"),
                control.get_attribute("data-testid"),
                control.get_attribute("accept"),
            ])))
            if "cover letter" in identity or "coverletter" in identity:
                continue
            is_resume = "resume" in identity or "cv" in identity
            is_only_document_input = file_inputs.count() == 1 and any(
                token in identity for token in ("pdf", "doc", "document", "application")
            )
            if is_resume or is_only_document_input:
                control.set_input_files(str(resume_path))
                page.wait_for_timeout(750)
                emit("log", "Attached the PDF resume through the file input fallback.",
                     jobId=job_id, status="filling")
                return True
        except Exception as exc:
            emit("log", f"Resume attachment attempt failed: {exc}", jobId=job_id, status="filling")
    return False


def _fill_pass(page: Page, profile: CandidateProfile, resume_path: Path, emit: Emit, job_id: str,
               ats_type: str | None = None) -> int:
    """Run one autofill pass.

    When *ats_type* is "greenhouse" or "lever" the dedicated strategy module
    runs first (giving it priority for fields like the phone country-code
    picker that the generic pass cannot handle).  The generic pass always
    runs afterwards as a safety net for any fields the strategy missed.
    """
    changed = 0
    container = _get_target_context(page, ats_type)

    # ── ATS-specific strategy pass ──────────────────────────────────────────
    if ats_type == "greenhouse":
        try:
            ats_changed = fill_greenhouse(page, container, profile, resume_path)
            if ats_changed:
                emit("log", f"Greenhouse strategy filled {ats_changed} fields.",
                     jobId=job_id, status="filling")
            changed += ats_changed
        except Exception as exc:
            emit("log", f"Greenhouse strategy error (falling back to generic): {exc}",
                 jobId=job_id, status="filling")
    elif ats_type == "lever":
        try:
            ats_changed = fill_lever(page, container, profile, resume_path)
            if ats_changed:
                emit("log", f"Lever strategy filled {ats_changed} fields.",
                     jobId=job_id, status="filling")
            changed += ats_changed
        except Exception as exc:
            emit("log", f"Lever strategy error (falling back to generic): {exc}",
                 jobId=job_id, status="filling")

    # ── Generic pass (resume attachment + remaining fields) ─────────────────
    changed += int(_attach_resume(page, container, resume_path, emit, job_id))

    controls = container.locator(
        'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select'
    )
    radio_names: set[str] = set()
    for index in range(controls.count()):
        control = controls.nth(index)
        if not _visible(control):
            continue
        kind = (control.get_attribute("type") or control.evaluate("el => el.tagName")).lower()
        label = _label(control)
        answer = answer_for(label, profile)
        if not answer:
            continue
        if kind == "radio":
            name = control.get_attribute("name") or label
            if name in radio_names:
                continue
            radio_names.add(name)
            changed += int(_fill_radio(control, answer))
        elif kind == "checkbox":
            if normalize(answer) in {"yes", "true"} and not control.is_checked():
                control.check(force=True)
                changed += 1
        elif kind == "select":
            changed += int(_fill_select(control, answer))
        else:
            changed += int(_fill_text(control, answer))

    custom = container.locator('[role="combobox"]:visible, button[aria-haspopup="listbox"]:visible')
    for index in range(custom.count()):
        control = custom.nth(index)
        current = (control.get_attribute("value") or control.inner_text()).strip()
        if current and normalize(current) not in {"select", "select one", "choose"}:
            continue
        answer = answer_for(_label(control), profile)
        if answer:
            changed += int(_fill_custom_select(control, answer))
    if changed:
        emit("log", f"Filled {changed} fields in this pass.", jobId=job_id, status="filling")
    return changed


def _click_apply(page: Page, container: Page | FrameLocator) -> None:
    if container.locator('form input, form textarea, form select').count():
        return
    candidates = page.get_by_role("link", name=re.compile(r"^(apply|apply now|apply for this job)$", re.I)).or_(
        page.get_by_role("button", name=re.compile(r"^(apply|apply now|apply for this job)$", re.I)))
    if candidates.count():
        candidates.first.click()
        try:
            page.wait_for_load_state("load", timeout=10000)
            page.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass


def _captcha(container: Page | FrameLocator) -> bool:
    # CAPTCHA containers remain in the DOM even after the candidate solves
    # them. Treat a populated response token/checked box as complete and only
    # pause for an active, unsolved challenge.
    responses = container.locator('textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"], textarea[name="h-captcha-response"]')
    for index in range(responses.count()):
        try:
            if (responses.nth(index).input_value() or "").strip():
                return False
        except Exception:
            continue
    checked = container.locator('[role="checkbox"][aria-checked="true"], .recaptcha-checkbox-checked')
    if checked.count():
        return False
    challenge = container.locator(
        'iframe[src*="recaptcha/api2/bframe" i]:visible, iframe[src*="hcaptcha.com/captcha" i]:visible, '
        '[role="dialog"] iframe[src*="captcha" i]:visible'
    )
    if challenge.count():
        return True
    containers = container.locator('.g-recaptcha:visible, .h-captcha:visible, [class*="captcha" i]:visible')
    return containers.count() > 0


def _unresolved_required(container: Page | FrameLocator) -> list[str]:
    result: list[str] = []
    required_files = container.locator('input[type="file"][required], input[type="file"][aria-required="true"]')
    for index in range(required_files.count()):
        item = required_files.nth(index)
        try:
            if not item.evaluate("el => Boolean(el.files && el.files.length)"):
                result.append(_label(item) or "Required resume/document upload")
        except Exception:
            continue
    controls = container.locator(
        'input[required]:not([type="file"]):visible, textarea[required]:visible, select[required]:visible, '
        '[aria-required="true"]:not(input[type="file"]):visible'
    )
    for index in range(controls.count()):
        item = controls.nth(index)
        try:
            kind = (item.get_attribute("type") or item.evaluate("el => el.tagName")).lower()
            if kind == "radio":
                name = item.get_attribute("name") or ""
                missing = not container.locator(f'input[type="radio"][name="{name}"]:checked').count() if name else not item.is_checked()
            elif kind == "checkbox":
                missing = not item.is_checked()
            else:
                missing = not (item.input_value() or "").strip()
            if missing:
                label = _label(item) or "Unlabelled required field"
                if label not in result:
                    result.append(label)
        except Exception:
            continue
    return result


def _submit(page: Page, container: Page | FrameLocator) -> bool:
    # Prefer semantic final-submit controls, then cover custom ATS buttons.
    candidates = container.locator(
        'button[type="submit"], input[type="submit"], '
        'button:has-text("Submit"), button:has-text("Send Application"), '
        'button:has-text("Complete Application"), button:has-text("Finish"), '
        'button:has-text("Apply")'
    )
    button: Locator | None = None
    final_action = re.compile(
        r"\b(submit|send application|complete application|finish application|finish and submit|apply now|apply)\b",
        re.I,
    )
    excluded = re.compile(r"linkedin|indeed|save|next|continue|review|preview|add another", re.I)
    for index in range(candidates.count()):
        candidate = candidates.nth(index)
        try:
            text = " ".join(filter(None, [
                candidate.inner_text(),
                candidate.get_attribute("value"),
                candidate.get_attribute("aria-label"),
            ])).strip()
            semantic_submit = (candidate.get_attribute("type") or "").lower() == "submit"
            if candidate.is_visible() and candidate.is_enabled() and not excluded.search(text) and (
                semantic_submit or final_action.search(text)
            ):
                button = candidate
                break
        except Exception:
            continue
    if button is None:
        return False
    button.scroll_into_view_if_needed()
    try:
        button.click(timeout=5000)
    except Exception:
        button.evaluate("el => el.click()")
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except PlaywrightTimeout:
        pass
    return True


SUCCESS_TEXT = re.compile(
    r"thank you for (applying|your application)|application (has been )?(submitted|received)|"
    r"we have received your application|thanks for applying",
    re.I,
)


def _submission_confirmed(page: Page) -> bool:
    try:
        url = page.url.lower()
        if any(marker in url for marker in ("/confirmation", "/thank-you", "/thank_you", "/thanks", "application-submitted")):
            return True
        if page.locator("#application_confirmation, .application--confirmation, [data-qa='application-confirmation']").count():
            return True
        messages = page.get_by_text(SUCCESS_TEXT)
        return any(messages.nth(index).is_visible() for index in range(messages.count()))
    except Exception:
        return False


def _wait_for_confirmation(page: Page, seconds: float = 15) -> bool:
    import time
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if _submission_confirmed(page):
            return True
        page.wait_for_timeout(300)
    return False


def _scroll_to_manual_target(page: Page, container: Page | FrameLocator) -> None:
    """Expose the control that needs human attention without touching CAPTCHA state."""
    try:
        captcha = container.locator('iframe[src*="captcha" i]:visible, .g-recaptcha:visible, [class*="captcha" i]:visible')
        if captcha.count():
            captcha.first.scroll_into_view_if_needed()
            return

        required = container.locator(
            'input[required]:visible, textarea[required]:visible, select[required]:visible, '
            '[aria-required="true"]:visible'
        )
        for index in range(required.count()):
            item = required.nth(index)
            kind = (item.get_attribute("type") or item.evaluate("el => el.tagName")).lower()
            if kind == "radio":
                name = item.get_attribute("name") or ""
                missing = not container.locator(f'input[type="radio"][name="{name}"]:checked').count() if name else not item.is_checked()
            elif kind == "checkbox":
                missing = not item.is_checked()
            else:
                missing = not (item.input_value() or "").strip()
            if missing:
                item.scroll_into_view_if_needed()
                item.evaluate("el => el.scrollIntoView({block: 'center', behavior: 'smooth'})")
                return

        submit = container.get_by_role("button", name=re.compile(r"^(submit application|submit|apply|verify)$", re.I)).or_(
            container.locator('input[type="submit"]'))
        if submit.count() and submit.first.is_visible():
            submit.first.scroll_into_view_if_needed()
            submit.first.evaluate("el => el.scrollIntoView({block: 'center', behavior: 'smooth'})")
        else:
            page.evaluate("window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'smooth'})")
    except Exception:
        # Scrolling is assistance only; failure must not close the manual form.
        pass


def _manual_action(page: Page, job: dict[str, Any], profile: CandidateProfile, resume_path: Path,
                   emit: Emit, stop: threading.Event, gate: ManualGate, reason: str) -> str:
    job_id = job["id"]
    gate.begin(job_id)
    ats_type = _detect_ats_type(page.url, job.get("ats"))
    container = _get_target_context(page, ats_type)
    _scroll_to_manual_target(page, container)
    emit("job", reason + " Complete it in the browser, then click Resume automation.",
         jobId=job_id, status="manual_action_required")
    try:
        while True:
            if stop.is_set():
                raise AutomationCancelled()
            if page.is_closed():
                emit("error", "The browser tab was closed before submission confirmation.",
                     jobId=job_id, status="submission_unconfirmed")
                return "unconfirmed"
            if _submission_confirmed(page):
                emit("job", f"Submission confirmed for {job['company']} — {job['title']}",
                     jobId=job_id, status="submission_confirmed")
                return "submitted"
            if gate.skip.wait(0.4):
                emit("job", f"Skipped {job['company']} — {job['title']}", jobId=job_id, status="skipped")
                return "skipped"
            if gate.resume.is_set():
                gate.resume.clear()
                # Re-detect ATS type from the live page URL in case of redirect
                current_url = page.url
                ats_type = _detect_ats_type(current_url, job.get("ats"))
                container = _get_target_context(page, ats_type)
                for _ in range(2):
                    if _fill_pass(page, profile, resume_path, emit, job_id, ats_type=ats_type) == 0:
                        break
                    page.wait_for_timeout(250)
                if _submission_confirmed(page):
                    continue
                unresolved = _unresolved_required(container)
                if unresolved or _captcha(container):
                    detail = "; ".join(unresolved[:4]) if unresolved else "CAPTCHA is still present"
                    emit("job", f"Manual action is still required: {detail}", jobId=job_id,
                         status="manual_action_required")
                    continue
                emit("job", "Required fields are complete; submitting now.", jobId=job_id, status="submitting")
                if not _submit(page, container) or not _wait_for_confirmation(page):
                    emit("job", "Submission is not confirmed. Submit manually, then click Resume automation.",
                         jobId=job_id, status="manual_action_required")
                    continue
    finally:
        gate.finish()


def _detect_ats_type(url: str, declared: str | None = None) -> str | None:
    """Determine the ATS type from the job URL, with a declared-type override."""
    if declared:
        return declared.lower() if declared.lower() in {"greenhouse", "lever", "ashby"} else None
    if is_greenhouse_url(url):
        return "greenhouse"
    if is_lever_url(url):
        return "lever"
    return None


def _process(page: Page, job: dict[str, Any], profile: CandidateProfile, resume_path: Path, emit: Emit,
             stop: threading.Event, gate: ManualGate) -> None:
    job_id = job["id"]
    url = job["url"]
    host = (urlparse(url).hostname or "").lower()
    allowed = (host == "greenhouse.io" or host.endswith(".greenhouse.io") or
               host == "lever.co" or host.endswith(".lever.co"))
    if not allowed:
        raise ValueError(f"unsupported application host: {host or 'invalid URL'}")

    # Detect the ATS type so strategy-specific logic can be used.
    ats_type = _detect_ats_type(url, job.get("ats"))
    ats_label = ats_type.capitalize() if ats_type else "Generic"
    container = _get_target_context(page, ats_type)

    emit("job", f"Opening {job['company']} — {job['title']} [{ats_label} strategy]",
         jobId=job_id, status="opening_browser")
    page.goto(url, wait_until="domcontentloaded", timeout=45000)
    _click_apply(page, container)
    if stop.is_set():
        raise AutomationCancelled()
    emit("job", f"Filling application using {ats_label} strategy.", jobId=job_id, status="filling")
    # Repeated passes cover fields revealed by earlier answers.
    for _ in range(4):
        if _fill_pass(page, profile, resume_path, emit, job_id, ats_type=ats_type) == 0:
            break
        page.wait_for_timeout(350)
    if _captcha(container):
        _manual_action(page, job, profile, resume_path, emit, stop, gate,
                       "CAPTCHA requires manual completion.")
        return
    emit("job", "Validating required fields.", jobId=job_id, status="validating")
    unresolved = _unresolved_required(container)
    if unresolved:
        preview = "; ".join(unresolved[:4])
        _manual_action(page, job, profile, resume_path, emit, stop, gate,
                       f"Required answers are missing: {preview}.")
        return
    emit("job", "Submitting completed application.", jobId=job_id, status="submitting")
    if not _submit(page, container):
        _manual_action(page, job, profile, resume_path, emit, stop, gate,
                       "A usable Submit button was not found.")
        return
    if _wait_for_confirmation(page):
         emit("job", f"Submission confirmed for {job['company']} — {job['title']}",
              jobId=job_id, status="submission_confirmed")
         return
    _manual_action(page, job, profile, resume_path, emit, stop, gate,
                   "Submit was clicked, but the ATS has not confirmed receipt.")


def run_jobs(jobs: list[dict[str, Any]], profile: CandidateProfile, resume_path: Path, emit: Emit,
             stop: threading.Event, gate: ManualGate) -> None:
    with sync_playwright() as playwright:
        browser: Browser = playwright.chromium.launch(headless=False, slow_mo=300, args=["--start-maximized", "--window-size=1600,900"])
        context = browser.new_context(no_viewport=True)
        
        # Abort requests to my.greenhouse.io to prevent the candidate portal 401 error from crashing the page React state
        context.route("**/my.greenhouse.io/**", lambda route: route.abort())
        
        try:
            # Process jobs in chunks of 10 (opening 10 tabs at once)
            chunk_size = 10
            for i in range(0, len(jobs), chunk_size):
                if stop.is_set():
                    raise AutomationCancelled()
                
                chunk = jobs[i:i+chunk_size]
                pages: list[tuple[Page, dict[str, Any]]] = []
                
                # Step 1: Open all tabs in the current chunk and fill them
                for job in chunk:
                    if stop.is_set():
                        raise AutomationCancelled()
                    page = context.new_page()
                    pages.append((page, job))
                    
                    job_id = job["id"]
                    url = job["url"]
                    ats_type = _detect_ats_type(url, job.get("ats"))
                    ats_label = ats_type.capitalize() if ats_type else "Generic"
                    container = _get_target_context(page, ats_type)
                    
                    emit("job", f"Opening {job['company']} — {job['title']} [{ats_label} strategy]",
                         jobId=job_id, status="opening_browser")
                    try:
                        page.goto(url, wait_until="load", timeout=45000)
                        _click_apply(page, container)
                        try:
                            page.wait_for_load_state("networkidle", timeout=5000)
                        except Exception:
                            pass
                        if stop.is_set():
                            raise AutomationCancelled()
                        emit("job", f"Filling application using {ats_label} strategy.", jobId=job_id, status="filling")
                        # Repeated passes cover fields revealed by earlier answers.
                        for _ in range(4):
                            if _fill_pass(page, profile, resume_path, emit, job_id, ats_type=ats_type) == 0:
                                break
                            page.wait_for_timeout(350)
                    except AutomationCancelled:
                        raise
                    except Exception as exc:
                        emit("error", f"{job['company']}: {exc}", jobId=job_id, status="failed")

                # Step 2: Process validation and submission for each tab sequentially
                for page, job in pages:
                    if stop.is_set():
                        raise AutomationCancelled()
                    if page.is_closed():
                        continue
                    
                    job_id = job["id"]
                    try:
                        page.bring_to_front()
                        if _submission_confirmed(page):
                            emit("job", f"Submission confirmed for {job['company']} — {job['title']}",
                                 jobId=job_id, status="submission_confirmed")
                        else:
                            # Always pause to let the user review the filled application and potentially skip it
                            _manual_action(page, job, profile, resume_path, emit, stop, gate,
                                           "Review the application, then click Resume or Skip.")
                        
                        page.wait_for_timeout(800)
                        page.close()
                    except AutomationCancelled:
                        raise
                    except Exception as exc:
                        emit("error", f"{job['company']}: {exc}", jobId=job_id, status="failed")
                        try:
                            page.close()
                        except Exception:
                            pass
        except AutomationCancelled:
            emit("status", "stopped", message="Batch stopped by the candidate.")
        finally:
            context.close()
            browser.close()
