"""Lever ATS autofill strategy for TalentScreen Apply.

Lever job boards (jobs.lever.co and custom-domain embeds) use a distinct
React-driven multi-section form. This module provides targeted autofill logic
that covers:

  * Personal information card (name, email, phone, company, title, location,
    links, resume upload)
  * Phone country-code dropdown (intl-tel-input or Lever's custom picker):
    uses the country from the candidate profile if present, otherwise defaults
    to "+1 United States".
  * "Additional information" / freetext questions
  * Equity / diversity questions (EEOC)
  * Work-authorization and sponsorship radio groups
  * Multi-page Lever apply flows (each page handled by calling this module,
    then clicking Next/Submit)

Lever's apply page structure changed in 2023-2024 from a single-page HTML
form to a React SPA served at ``/apply``. This module targets both the legacy
``/apply`` HTML path and the newer React form.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from playwright.sync_api import FrameLocator, Locator, Page

from .profile import CandidateProfile
from .rules import answer_for, best_option, normalize, boolean_text, find_best_country_option

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default country dial code when the profile has no country information.
_DEFAULT_COUNTRY_CODE = "+1 United States"

# Reuse the same mapping from the Greenhouse strategy so we stay DRY.
# Import lazily to avoid a hard circular dependency if both are loaded together.
def _get_country_dialcode_map() -> dict[str, str]:
    from .ats_greenhouse import COUNTRY_TO_DIALCODE
    return COUNTRY_TO_DIALCODE


def _resolve_phone_country(profile: CandidateProfile) -> str:
    """Return the dial-code label to select for the phone country dropdown."""
    raw = (profile.country or "").strip()
    if raw:
        table = _get_country_dialcode_map()
        key = normalize(raw)
        label = table.get(key)
        if label:
            return label
        for country_key, dial_label in table.items():
            if country_key in key or key in country_key:
                return dial_label
    return _DEFAULT_COUNTRY_CODE


# ---------------------------------------------------------------------------
# Lever DOM selectors
# ---------------------------------------------------------------------------

# Lever's field naming conventions (data-field or id attributes)
_LEVER_PERSONAL_FIELDS: list[tuple[list[str], str]] = [
    # (attribute_names_to_try, profile_value_attr_name)
    (["name", "full-name", "fullName"],        "full_name"),
    (["email", "Email"],                        "email"),
    (["phone", "Phone", "phone_number"],        "phone"),
    (["org", "company", "currentCompany",
      "current-company", "employer"],           "current_company"),
    (["headline", "title", "currentTitle",
      "current-title", "job-title"],            "current_title"),
    (["location", "city", "Location"],          "city"),
    (["urls[LinkedIn]", "linkedin",
      "linkedInUrl", "LinkedIn"],               "linkedin"),
    (["urls[portfolio]", "website",
      "portfolio", "portfolioUrl"],             "website"),
    (["urls[GitHub]", "github", "GitHub"],      "github"),
]

# Phone country-code picker selectors (Lever uses iti or custom select)
_PHONE_CC_SELECTOR = (
    ".iti__selected-flag, "
    "button.iti__selected-flag, "
    "[data-qa='phone-country-code'], "
    ".lever-phone-country-selector, "
    "select[name='phoneCountry'], "
    "select.phone-country"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _lever_dispatch(control: Locator) -> None:
    control.evaluate(
        "el => { "
        "el.dispatchEvent(new Event('input', {bubbles:true})); "
        "el.dispatchEvent(new Event('change', {bubbles:true})); "
        "el.dispatchEvent(new Event('blur',  {bubbles:true})); "
        "}"
    )


def _lever_fill_field(container: Page | FrameLocator, field_names: list[str], value: str) -> bool:
    """Try to fill a Lever text input / textarea using various attribute strategies."""
    if not value:
        return False
    selectors: list[str] = []
    for name in field_names:
        selectors += [
            f'input[name="{name}"]',
            f'textarea[name="{name}"]',
            f'input[id="{name}"]',
            f'textarea[id="{name}"]',
            f'input[data-field="{name}"]',
            f'textarea[data-field="{name}"]',
            f'input[placeholder*="{name}" i]',
        ]
    for sel in selectors:
        try:
            loc = container.locator(sel).first
            if not loc.count() or not loc.is_visible() or not loc.is_enabled():
                continue
            existing = (loc.input_value() or "").strip()
            if existing:
                return False  # don't overwrite user-entered data
            loc.fill(value)
            _lever_dispatch(loc)
            return True
        except Exception:
            continue
    return False


def _lever_fill_phone_country_iti(page: Page, container: Page | FrameLocator, profile: CandidateProfile) -> bool:
    """Handle the intl-tel-input (iti) phone country picker on Lever forms."""
    wanted = _resolve_phone_country(profile)

    # Native <select> style (some Lever versions)
    native_sel = container.locator("select[name='phoneCountry'], select.phone-country").first
    if native_sel.count() and native_sel.is_visible():
        try:
            options = native_sel.locator("option").all_text_contents()
            choice = find_best_country_option(wanted, options)
            if choice:
                native_sel.select_option(label=choice)
                _lever_dispatch(native_sel)
                return True
        except Exception:
            pass

    # Find the trigger
    trigger = container.locator(
        ".iti__selected-flag, "
        "button.iti__selected-flag, "
        "button:has-text('Country'), "
        "[role='combobox']:has-text('Country'), "
        "[aria-haspopup='listbox']:has-text('Country'), "
        ".phone-country-selector, "
        "[data-qa='phone-country-code']"
    ).first

    if not trigger.count() or not trigger.is_visible():
        phone_input = container.locator("input[type='tel'], input[name='phone'], input[id='phone'], input[name*='phone' i]").first
        if phone_input.count() and phone_input.is_visible():
            parent = phone_input.locator("xpath=..")
            btn = parent.locator("button, [role='button'], [role='combobox']").first
            if not btn.count() or not btn.is_visible():
                parent = phone_input.locator("xpath=../..")
                btn = parent.locator("button, [role='button'], [role='combobox']").first
            if btn.count() and btn.is_visible():
                trigger = btn

    if not trigger.count() or not trigger.is_visible():
        return False

    try:
        # Already correct?
        current = (
            trigger.get_attribute("aria-label") or
            trigger.get_attribute("title") or
            trigger.inner_text() or ""
        ).strip()
        if normalize(wanted) in normalize(current):
            return False

        trigger.click()
        page.wait_for_timeout(300)

        country_items = container.locator(
            "ul.iti__country-list .iti__country, "
            ".iti__country-list li[data-country-code], "
            "[role='listbox'] [role='option'], "
            ".country-list li, "
            "ul.country-list li, "
            "ul[class*='country'] li, "
            "li[id*='country'], "
            "li[class*='country']"
        )
        if not country_items.count():
            page.keyboard.press("Escape")
            return False

        texts = country_items.all_text_contents()
        choice = find_best_country_option(wanted, texts)
        if not choice:
            dial_match = re.search(r"\+\d+", wanted)
            if dial_match:
                choice = find_best_country_option(dial_match.group(), texts)
        if not choice:
            page.keyboard.press("Escape")
            return False

        for i, txt in enumerate(texts):
            if txt == choice:
                country_items.nth(i).click()
                page.wait_for_timeout(200)
                return True

        page.keyboard.press("Escape")
    except Exception:
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
    return False


# ---------------------------------------------------------------------------
# Resume attachment
# ---------------------------------------------------------------------------

def _lever_attach_resume(page: Page, container: Page | FrameLocator, resume_path: Path) -> bool:
    """Attach the resume to the Lever application form.

    Lever renders a drag-and-drop area or a file input labelled
    'Resume/CV'.  We try the styled trigger first, then a raw file input.
    """
    if not resume_path or not resume_path.is_file():
        return False

    # Check if already attached
    already = container.locator(
        '.resume-name, .file-name, [data-test="resume-filename"], '
        '.resume-filename, .attached-filename, .lever-resume-name'
    )
    if already.count() and any(
        already.nth(i).is_visible() for i in range(already.count())
    ):
        return False

    # Try visible upload/attach trigger button
    triggers = container.locator(
        'button:has-text("Upload"), button:has-text("Attach"), '
        'button:has-text("Choose File"), button:has-text("Browse"), '
        'label:has-text("Upload"), label:has-text("Attach"), '
        'a:has-text("upload"), a:has-text("attach")'
    )
    for i in range(triggers.count()):
        trigger = triggers.nth(i)
        try:
            if not trigger.is_visible():
                continue
            context_text = normalize(trigger.inner_text())
            if "cover" in context_text:
                continue
            with page.expect_file_chooser(timeout=3000) as fc:
                trigger.click()
            fc.value.set_files(str(resume_path))
            page.wait_for_timeout(1000)
            return True
        except Exception:
            continue

    # Fallback: hidden file input with resume/cv in its identity
    file_inputs = container.locator('input[type="file"]')
    for i in range(file_inputs.count()):
        fi = file_inputs.nth(i)
        try:
            ident = normalize(" ".join(filter(None, [
                fi.get_attribute("id") or "",
                fi.get_attribute("name") or "",
                fi.get_attribute("aria-label") or "",
                fi.get_attribute("accept") or "",
                fi.get_attribute("data-test") or "",
            ])))
            if "cover" in ident:
                continue
            already_set = fi.evaluate("el => Boolean(el.files && el.files.length)")
            if already_set:
                continue
            if "resume" in ident or "cv" in ident or "document" in ident or file_inputs.count() == 1:
                fi.set_input_files(str(resume_path))
                page.wait_for_timeout(750)
                return True
        except Exception:
            continue
    return False


# ---------------------------------------------------------------------------
# EEO / diversity fields
# ---------------------------------------------------------------------------

_LEVER_EEO_DEFAULTS: dict[str, str] = {
    "gender":     "Decline To Self Identify",   # overridden by predicted_gender below
    "race":       "Decline to self-identify",    # exact Lever form label
    "veteran":    "I am a veteran",              # ALWAYS select veteran
    "disability": "No, I don't have a disability",
}


def _lever_eeo_answer(label: str, profile: CandidateProfile) -> str | None:
    """Return the EEO answer for a given label.

    Gender: uses ``profile.predicted_gender`` (spaCy + gender-guesser result).
      - "Male" or "Female" if successfully predicted.
      - "Decline To Self Identify" if ambiguous / unknown.
    Veteran: ALWAYS returns ``"I am a veteran"``.
      - ``best_option()`` in the caller fuzzy-matches this against the actual
        option list ("I am a veteran", "I am not a veteran",
        "Decline to self-identify", etc.).
    Race: defaults to ``"Decline to self-identify"``.
    Disability: uses ``profile.disability_status``.
    """
    q = normalize(label)
    # Explicit JSON answers have highest priority.
    for key, val in profile.explicit_answers.items():
        if normalize(str(key)) == q and val is not None:
            return str(val)

    # ── Gender ──────────────────────────────────────────────────────────────
    if "gender" in q:
        if profile.predicted_gender in ("Male", "Female"):
            return profile.predicted_gender
        # Fall back to any manually-supplied explicit gender value
        explicit = profile.explicit_answers.get("gender")
        if explicit:
            return str(explicit)
        return "Decline To Self Identify"

    # ── Race / Ethnicity ─────────────────────────────────────────────────────
    if "race" in q or "ethnicity" in q:
        explicit = profile.explicit_answers.get("race")
        # Pass explicit value; best_option() will fuzzy-match it.
        # If none, return Decline (exact Lever label).
        return str(explicit) if explicit else "Decline to self-identify"

    # ── Veteran — ALWAYS "I am a veteran" ──────────────────────────────────
    if "veteran" in q:
        return "I am a veteran"

    # ── Disability ────────────────────────────────────────────────────────────
    if "disability" in q:
        return profile.disability_status or "No, I don't have a disability"

    return None


# ---------------------------------------------------------------------------
# Custom questions
# ---------------------------------------------------------------------------

def _lever_fill_question(
    page: Page,
    root: Page | FrameLocator,
    container: Locator,
    profile: CandidateProfile,
) -> bool:
    """Fill a single Lever custom-question container. Returns True if filled."""
    try:
        if not container.is_visible():
            return False

        # Extract label text
        lbl = container.locator(
            "label, legend, .application-label, [class*='label'], .question-title, h3"
        ).first
        label_text = (lbl.inner_text() if lbl.count() else "").strip()
        if not label_text:
            return False

        # Determine answer
        ans = (
            _lever_eeo_answer(label_text, profile)
            or answer_for(label_text, profile)
        )
        if not ans:
            return False

        # Native <select>
        sel = container.locator("select").first
        if sel.count() and sel.is_visible():
            options = sel.locator("option").all_text_contents()
            choice = best_option(ans, options)
            if choice:
                sel.select_option(label=choice)
                _lever_dispatch(sel)
                return True
            return False

        # Radio buttons
        radios = container.locator("input[type='radio']")
        if radios.count():
            pairs: list[tuple[Locator, str]] = []
            for ri in range(radios.count()):
                r = radios.nth(ri)
                rid = r.get_attribute("id")
                if rid:
                    assoc = root.locator(f'label[for="{rid}"]')
                    lbl_txt = assoc.inner_text().strip() if assoc.count() else ""
                else:
                    lbl_txt = ""
                lbl_txt = lbl_txt or r.get_attribute("value") or ""
                pairs.append((r, lbl_txt))
            choice = best_option(ans, [t for _, t in pairs])
            for r, t in pairs:
                if t == choice:
                    r.check(force=True)
                    _lever_dispatch(r)
                    return True
            return False

        # Checkbox
        cb = container.locator("input[type='checkbox']").first
        if cb.count() and cb.is_visible():
            if normalize(ans) in {"yes", "true", "1"} and not cb.is_checked():
                cb.check(force=True)
                return True
            return False

        # Text / textarea / email / url
        ti = container.locator(
            "textarea, input[type='text'], input[type='email'], "
            "input[type='url'], input[type='tel'], input:not([type])"
        ).first
        if ti.count() and ti.is_visible() and ti.is_enabled():
            existing = (ti.input_value() or "").strip()
            if not existing:
                ti.fill(ans)
                _lever_dispatch(ti)
                return True

    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# Main Lever fill entry-point
# ---------------------------------------------------------------------------

def fill_lever(page: Page, container: Page | FrameLocator, profile: CandidateProfile, resume_path: Path) -> int:
    """Fill all detectable Lever application fields.

    Returns the number of fields/sections successfully filled so the caller
    can decide whether to run additional passes.
    """
    changed = 0

    # ── 1. Resume ────────────────────────────────────────────────────────────
    if _lever_attach_resume(page, container, resume_path):
        changed += 1

    # ── 2. Personal information fields ───────────────────────────────────────
    profile_values: dict[str, str] = {
        "full_name":       profile.full_name,
        "email":           profile.email,
        "phone":           profile.phone,
        "current_company": profile.current_company,
        "current_title":   profile.current_title,
        "city":            profile.city,
        "linkedin":        profile.linkedin,
        "github":          profile.github,
        "website":         profile.website,
    }
    for field_names, profile_attr in _LEVER_PERSONAL_FIELDS:
        value = profile_values.get(profile_attr, "")
        if value:
            if _lever_fill_field(container, field_names, value):
                changed += 1

    # ── 3. Phone country code ────────────────────────────────────────────────
    if profile.phone:
        if _lever_fill_phone_country_iti(page, container, profile):
            changed += 1

    # ── 4. Work authorization radio (Lever renders these as radio groups) ────
    if profile.authorized_to_work is not None:
        auth_containers = container.locator(
            '[data-qa*="authorization"], [data-field*="authorized"], '
            '.application-question:has-text("authorized"), '
            '.application-question:has-text("work authorization")'
        )
        for i in range(auth_containers.count()):
            if _lever_fill_question(page, container, auth_containers.nth(i), profile):
                changed += 1

    # ── 5. Sponsorship radio ──────────────────────────────────────────────────
    if profile.requires_sponsorship is not None:
        spon_containers = container.locator(
            '[data-qa*="sponsorship"], [data-field*="sponsor"], '
            '.application-question:has-text("sponsorship"), '
            '.application-question:has-text("visa")'
        )
        for i in range(spon_containers.count()):
            if _lever_fill_question(page, container, spon_containers.nth(i), profile):
                changed += 1

    # ── 6. Generic custom / additional questions ─────────────────────────────
    # Lever places custom questions inside .application-question or
    # [data-qa="additional-cards"] sub-sections.
    question_wrappers = container.locator(
        '.application-question, [data-qa="additional-cards"] .question, '
        '.lever-question, .custom-question-wrapper, '
        'ul.application-additional li, .application-additional-item'
    )
    for i in range(question_wrappers.count()):
        qw = question_wrappers.nth(i)
        if _lever_fill_question(page, container, qw, profile):
            changed += 1

    # ── 7. EEO / Diversity section ───────────────────────────────────────────
    # Lever's EEO section is often a separate card at the bottom of the form.
    eeo_card = container.locator(
        '[data-qa="eeoc-section"], .eeoc-section, '
        '.diversity-section, #eeo, #eeoc'
    ).first
    if eeo_card.count() and eeo_card.is_visible():
        eeo_questions = eeo_card.locator(
            '.application-question, .field, [data-qa="question"]'
        )
        for i in range(eeo_questions.count()):
            if _lever_fill_question(page, container, eeo_questions.nth(i), profile):
                changed += 1

    # ── 8. Salary / compensation ─────────────────────────────────────────────
    if profile.minimum_salary:
        salary_inputs = container.locator(
            'input[name*="salary" i], input[name*="compensation" i], '
            'input[id*="salary" i], input[placeholder*="salary" i]'
        )
        for i in range(salary_inputs.count()):
            si = salary_inputs.nth(i)
            try:
                if si.is_visible() and si.is_enabled() and not (si.input_value() or "").strip():
                    si.fill(profile.minimum_salary)
                    _lever_dispatch(si)
                    changed += 1
                    break
            except Exception:
                continue

    return changed


def is_lever_url(url: str) -> bool:
    """Return True if the URL is served by Lever."""
    try:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
        return host == "jobs.lever.co" or host.endswith(".lever.co")
    except Exception:
        return False
