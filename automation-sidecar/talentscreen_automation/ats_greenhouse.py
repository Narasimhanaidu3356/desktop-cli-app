"""Greenhouse ATS autofill strategy for TalentScreen Apply.

Greenhouse job boards (boards.greenhouse.io, job-boards.greenhouse.io, and
custom domain embeds) share a well-documented DOM structure. This module
provides targeted autofill logic that goes beyond the generic pass in
browser.py and handles:

  * Structured personal-info fields (first/last name, email, phone with
    country-code dropdown, location, LinkedIn, portfolio/website)
  * Resume attachment via the Greenhouse widget trigger
  * Custom questions (text, textarea, select, radio, checkbox, boolean
    yes/no dropdowns)
  * Demographic / EEO questions (gender, race/ethnicity, veteran status,
    disability self-identification)
  * Phone country-code picker: uses the country from the candidate profile if
    present, otherwise defaults to "+1 United States".
  * Multi-step Greenhouse forms (each page is handled by calling this module's
    fill function, then clicking the Next/Continue button).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from playwright.sync_api import Locator, Page

from .profile import CandidateProfile
from .rules import answer_for, best_option, normalize, boolean_text

# ---------------------------------------------------------------------------
# Greenhouse-specific CSS / attribute selectors
# ---------------------------------------------------------------------------

# Field IDs used on boards.greenhouse.io and job-boards.greenhouse.io
_GH_FIRST_NAME = ["first-name", "first_name", "FirstName"]
_GH_LAST_NAME  = ["last-name",  "last_name",  "LastName"]
_GH_EMAIL      = ["email", "Email"]
_GH_PHONE      = ["phone", "Phone", "phone_number"]
_GH_LINKEDIN   = ["job_application_urls_linkedin_linkedin_profile_url",
                   "linkedin_profile_url", "linkedin", "LinkedIn"]
_GH_PORTFOLIO  = ["job_application_urls_0_", "website", "portfolio",
                   "online_portfolio"]
_GH_RESUME     = ["resume", "resume_text"]  # file input ids

# Country-code selectors for the phone field Greenhouse renders as a custom
# dropdown button that opens a listbox overlay.
_PHONE_CC_SELECTOR = (
    "button.iti__selected-flag, "
    ".iti__flag-container button, "
    "[data-qa='phone-country-code'], "
    ".phone-country-code-selector"
)

# Default country dial code when the profile has no country information.
_DEFAULT_COUNTRY_CODE = "+1 United States"

# Mapping of ISO 3166-1 alpha-2 codes / common country names to the text that
# Greenhouse renders in its intl-tel-input dropdown.
COUNTRY_TO_DIALCODE: dict[str, str] = {
    # North America
    "us": "+1 United States",
    "usa": "+1 United States",
    "united states": "+1 United States",
    "united states of america": "+1 United States",
    "ca": "+1 Canada",
    "canada": "+1 Canada",
    "mx": "+52 Mexico",
    "mexico": "+52 Mexico",
    # Europe
    "gb": "+44 United Kingdom",
    "uk": "+44 United Kingdom",
    "united kingdom": "+44 United Kingdom",
    "de": "+49 Germany",
    "germany": "+49 Germany",
    "fr": "+33 France",
    "france": "+33 France",
    "nl": "+31 Netherlands",
    "netherlands": "+31 Netherlands",
    "se": "+46 Sweden",
    "sweden": "+46 Sweden",
    "no": "+47 Norway",
    "norway": "+47 Norway",
    "dk": "+45 Denmark",
    "denmark": "+45 Denmark",
    "fi": "+358 Finland",
    "finland": "+358 Finland",
    "ie": "+353 Ireland",
    "ireland": "+353 Ireland",
    "es": "+34 Spain",
    "spain": "+34 Spain",
    "pt": "+351 Portugal",
    "portugal": "+351 Portugal",
    "it": "+39 Italy",
    "italy": "+39 Italy",
    "be": "+32 Belgium",
    "belgium": "+32 Belgium",
    "ch": "+41 Switzerland",
    "switzerland": "+41 Switzerland",
    "at": "+43 Austria",
    "austria": "+43 Austria",
    "pl": "+48 Poland",
    "poland": "+48 Poland",
    "cz": "+420 Czech Republic",
    "czech republic": "+420 Czech Republic",
    "ro": "+40 Romania",
    "romania": "+40 Romania",
    "hu": "+36 Hungary",
    "hungary": "+36 Hungary",
    # Asia-Pacific
    "in": "+91 India",
    "india": "+91 India",
    "au": "+61 Australia",
    "australia": "+61 Australia",
    "nz": "+64 New Zealand",
    "new zealand": "+64 New Zealand",
    "sg": "+65 Singapore",
    "singapore": "+65 Singapore",
    "jp": "+81 Japan",
    "japan": "+81 Japan",
    "cn": "+86 China",
    "china": "+86 China",
    "hk": "+852 Hong Kong",
    "hong kong": "+852 Hong Kong",
    "kr": "+82 South Korea",
    "south korea": "+82 South Korea",
    "ph": "+63 Philippines",
    "philippines": "+63 Philippines",
    "id": "+62 Indonesia",
    "indonesia": "+62 Indonesia",
    "my": "+60 Malaysia",
    "malaysia": "+60 Malaysia",
    "th": "+66 Thailand",
    "thailand": "+66 Thailand",
    "vn": "+84 Vietnam",
    "vietnam": "+84 Vietnam",
    "pk": "+92 Pakistan",
    "pakistan": "+92 Pakistan",
    "bd": "+880 Bangladesh",
    "bangladesh": "+880 Bangladesh",
    # Middle-East / Africa
    "il": "+972 Israel",
    "israel": "+972 Israel",
    "ae": "+971 United Arab Emirates",
    "uae": "+971 United Arab Emirates",
    "united arab emirates": "+971 United Arab Emirates",
    "sa": "+966 Saudi Arabia",
    "saudi arabia": "+966 Saudi Arabia",
    "za": "+27 South Africa",
    "south africa": "+27 South Africa",
    "ng": "+234 Nigeria",
    "nigeria": "+234 Nigeria",
    "ke": "+254 Kenya",
    "kenya": "+254 Kenya",
    # Latin America
    "br": "+55 Brazil",
    "brazil": "+55 Brazil",
    "ar": "+54 Argentina",
    "argentina": "+54 Argentina",
    "co": "+57 Colombia",
    "colombia": "+57 Colombia",
    "cl": "+56 Chile",
    "chile": "+56 Chile",
    "pe": "+51 Peru",
    "peru": "+51 Peru",
}


def _resolve_phone_country(profile: CandidateProfile) -> str:
    """Return the dial-code label to select for the phone country dropdown.

    Priority:
      1. ``profile.country`` if it maps to a known dial-code label.
      2. Fallback to ``_DEFAULT_COUNTRY_CODE`` (+1 United States).
    """
    raw = (profile.country or "").strip()
    if raw:
        key = normalize(raw)
        label = COUNTRY_TO_DIALCODE.get(key)
        if label:
            return label
        # Try partial match for longer country names stored in the profile
        for country_key, dial_label in COUNTRY_TO_DIALCODE.items():
            if country_key in key or key in country_key:
                return dial_label
    return _DEFAULT_COUNTRY_CODE


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _gh_dispatch(control: Locator) -> None:
    control.evaluate(
        "el => { el.dispatchEvent(new Event('input', {bubbles:true})); "
        "el.dispatchEvent(new Event('change', {bubbles:true})); }"
    )


def _gh_fill_input(page: Page, field_id: str, value: str) -> bool:
    """Fill a visible text input/textarea by id."""
    for selector in (f"#{field_id}", f'[name="{field_id}"]', f'[data-field="{field_id}"]'):
        try:
            loc = page.locator(selector).first
            if loc.count() and loc.is_visible() and loc.is_enabled():
                existing = (loc.input_value() or "").strip()
                if existing:
                    return False  # already filled – don't overwrite
                loc.fill(value)
                _gh_dispatch(loc)
                return True
        except Exception:
            continue
    return False


def _gh_try_ids(page: Page, ids: list[str], value: str) -> bool:
    for field_id in ids:
        if _gh_fill_input(page, field_id, value):
            return True
    return False


def _gh_fill_phone_country(page: Page, profile: CandidateProfile) -> bool:
    """Set the phone number country-code flag picker on Greenhouse forms.

    Greenhouse uses the intl-tel-input library which renders a <button>
    (or <div role='button'>) that opens a country list overlay.
    """
    wanted = _resolve_phone_country(profile)

    # Detect the trigger button
    trigger = page.locator(_PHONE_CC_SELECTOR).first
    if not trigger.count():
        return False
    try:
        if not trigger.is_visible():
            return False

        # Already correct? Check aria-label or title attribute.
        current_label = (
            trigger.get_attribute("aria-label") or
            trigger.get_attribute("title") or
            trigger.inner_text()
        ).strip()
        if normalize(wanted) in normalize(current_label):
            return False  # already set correctly

        trigger.click()
        page.wait_for_timeout(300)

        # The dropdown list items use data-country-code or li[data-dial-code]
        country_list = page.locator(
            'ul.iti__country-list li[data-country-code], '
            '.iti__country-list .iti__country, '
            '[role="listbox"] [role="option"]'
        )
        if not country_list.count():
            page.keyboard.press("Escape")
            return False

        all_texts = country_list.all_text_contents()
        choice = best_option(wanted, all_texts)
        if not choice:
            # Fallback: try matching just the dial code number
            dial_num = re.search(r"\+\d+", wanted)
            if dial_num:
                choice = best_option(dial_num.group(), all_texts)
        if not choice:
            page.keyboard.press("Escape")
            return False

        for i, txt in enumerate(all_texts):
            if txt == choice:
                country_list.nth(i).click()
                page.wait_for_timeout(200)
                return True

        page.keyboard.press("Escape")
    except Exception:
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
    return False


def _gh_fill_select(page: Page, selector: str, answer: str) -> bool:
    try:
        loc = page.locator(selector).first
        if not loc.count() or not loc.is_visible():
            return False
        options = loc.locator("option").all_text_contents()
        choice = best_option(answer, options)
        if not choice:
            return False
        loc.select_option(label=choice)
        _gh_dispatch(loc)
        return True
    except Exception:
        return False


def _gh_fill_custom_dropdown(page: Page, label_text: str, answer: str) -> bool:
    """Handle Greenhouse custom <select> wrappers that appear as styled divs."""
    try:
        # Greenhouse wraps selects with a label; find the select sibling.
        label_loc = page.get_by_text(re.compile(re.escape(label_text), re.I)).first
        if not label_loc.count():
            return False
        parent = label_loc.locator("xpath=ancestor::div[@class and (contains(@class,'field') or contains(@class,'question'))][1]")
        if not parent.count():
            return False
        sel = parent.locator("select").first
        if sel.count() and sel.is_visible():
            options = sel.locator("option").all_text_contents()
            choice = best_option(answer, options)
            if choice:
                sel.select_option(label=choice)
                _gh_dispatch(sel)
                return True
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# EEO / demographic helpers
# ---------------------------------------------------------------------------

_GENDER_ANSWERS = {
    "male":     "Male",
    "man":      "Male",
    "m":        "Male",
    "female":   "Female",
    "woman":    "Female",
    "f":        "Female",
    "non-binary":     "Non-binary",
    "nonbinary":      "Non-binary",
    "non binary":     "Non-binary",
    "decline":        "Decline To Self Identify",
    "prefer not":     "Decline To Self Identify",
    "not to say":     "Decline To Self Identify",
    "self identify":  "Decline To Self Identify",
}

# All veteran option variants we have seen across ATS forms
# (Greenhouse, Lever, Ashby, iCIMS, etc.).
# The key we always *want* to select is "I am a veteran" — best_option()
# will fuzzy-match it against whatever labels the specific form uses.
_VETERAN_ANSWERS = {
    # Affirm veteran status — this is what we always want
    "yes":                 "I am a veteran",
    "veteran":             "I am a veteran",
    "i am a veteran":      "I am a veteran",
    # Negative (kept for reference; we never send these)
    "no":                  "I am not a veteran",
    "not a veteran":       "I am not a veteran",
    "i am not a veteran":  "I am not a veteran",
    # Decline
    "decline":             "Decline to self-identify",
    "prefer not":          "Decline to self-identify",
}

# Race / Ethnicity options — exact Greenhouse / Lever form labels
# We default to Decline; if the profile has an explicit race, we pass it
# through and best_option() fuzzy-matches it to the nearest option.
_RACE_OPTIONS = [
    "Hispanic or Latino",
    "White (Not Hispanic or Latino)",
    "Black or African American (Not Hispanic or Latino)",
    "Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)",
    "Asian (Not Hispanic or Latino)",
    "American Indian or Alaska Native (Not Hispanic or Latino)",
    "Two or More Races (Not Hispanic or Latino)",
    "Decline to self-identify",
    "I don't wish to answer",
    "Decline To Self Identify",
]


def _eeo_answer(label: str, profile: CandidateProfile) -> str | None:
    """Return an appropriate EEO/demographic answer from the profile.

    Gender:
      - Uses ``profile.predicted_gender`` (spaCy + gender-guesser result).
      - "Male" or "Female" if confidently predicted.
      - ``None`` → caller falls through to "Decline To Self Identify".
    Veteran:
      - ALWAYS returns ``"I am a veteran"``.
      - ``best_option()`` fuzzy-matches this against whatever the specific ATS
        form labels its veteran option (e.g. "I am a veteran",
        "I identify as one or more of the classifications of a protected veteran",
        "Protected Veteran" …).
    Race:
      - Defaults to ``"Decline to self-identify"``.
      - If the profile has an explicit race value, passes it through.
    Disability:
      - Defaults to ``"No, I don't have a disability"``.
    """
    q = normalize(label)
    # Explicit JSON answers always win.
    for key, val in profile.explicit_answers.items():
        if normalize(str(key)) == q:
            return str(val)

    # ── Gender ──────────────────────────────────────────────────────────────
    if "gender" in q:
        if profile.predicted_gender in ("Male", "Female"):
            return profile.predicted_gender
        explicit_gender = normalize(str(profile.explicit_answers.get("gender", ""))).strip()
        if explicit_gender:
            return _GENDER_ANSWERS.get(explicit_gender, "Decline To Self Identify")
        return "Decline To Self Identify"

    # ── Race / Ethnicity ─────────────────────────────────────────────────────
    if "race" in q or "ethnicity" in q:
        raw = str(profile.explicit_answers.get("race", "")).strip()
        # Pass the explicit value through and let best_option() match it;
        # if empty, default to Decline.
        return raw if raw else "Decline to self-identify"

    # ── Veteran status — ALWAYS "I am a veteran" ─────────────────────────────
    if "veteran" in q:
        # Return the key phrase; best_option() will fuzzy-match it against
        # whatever labels the ATS renders (see _VETERAN_ANSWERS above for the
        # full range of known labels).
        return "I am a veteran"

    # ── Disability ────────────────────────────────────────────────────────────
    if "disability" in q:
        return profile.disability_status or "No, I don't have a disability"

    return None


# ---------------------------------------------------------------------------
# Main Greenhouse fill entry-point
# ---------------------------------------------------------------------------

def fill_greenhouse(page: Page, profile: CandidateProfile, resume_path: Path) -> int:
    """Fill all detectable Greenhouse application fields.

    Returns the number of fields successfully filled so the caller can decide
    whether to continue with additional passes.
    """
    changed = 0

    # ── 1. Resume attachment ────────────────────────────────────────────────
    # Greenhouse renders a styled upload button; the actual <input type=file>
    # may be hidden.  We try the widget trigger first, then the raw input.
    if resume_path and resume_path.is_file():
        # Try the Greenhouse "Attach" button
        attach_btn = page.locator(
            'button:has-text("Attach"), button:has-text("Upload"), '
            'button:has-text("Choose File"), a:has-text("Attach")'
        ).first
        if attach_btn.count() and attach_btn.is_visible():
            try:
                # Check if resume already attached
                already = page.locator(
                    '.resume-filename, [data-qa="resume-display-name"], '
                    '.resume-file-name, .attached-resume-name'
                )
                if not already.count() or not any(
                    already.nth(i).is_visible() for i in range(already.count())
                ):
                    with page.expect_file_chooser(timeout=3000) as fc:
                        attach_btn.click()
                    fc.value.set_files(str(resume_path))
                    page.wait_for_timeout(1000)
                    changed += 1
            except Exception:
                pass

        # Fallback to raw hidden file input
        if changed == 0:
            file_inputs = page.locator('input[type="file"]')
            for i in range(file_inputs.count()):
                fi = file_inputs.nth(i)
                try:
                    ident = " ".join(filter(None, [
                        fi.get_attribute("id") or "",
                        fi.get_attribute("name") or "",
                        fi.get_attribute("aria-label") or "",
                        fi.get_attribute("accept") or "",
                    ])).lower()
                    if "cover" in ident:
                        continue
                    already = fi.evaluate("el => Boolean(el.files && el.files.length)")
                    if not already:
                        fi.set_input_files(str(resume_path))
                        page.wait_for_timeout(750)
                        changed += 1
                        break
                except Exception:
                    continue

    # ── 2. Standard personal fields ─────────────────────────────────────────
    if profile.first_name:
        changed += int(_gh_try_ids(page, _GH_FIRST_NAME, profile.first_name))
    if profile.last_name:
        changed += int(_gh_try_ids(page, _GH_LAST_NAME, profile.last_name))
    if profile.email:
        changed += int(_gh_try_ids(page, _GH_EMAIL, profile.email))

    # ── 3. Phone + country code ─────────────────────────────────────────────
    if profile.phone:
        # Set the country code flag first (before filling the number)
        changed += int(_gh_fill_phone_country(page, profile))
        changed += int(_gh_try_ids(page, _GH_PHONE, profile.phone))

    # ── 4. Location fields ──────────────────────────────────────────────────
    if profile.city:
        changed += int(_gh_try_ids(page, ["city", "City"], profile.city))
    if profile.state:
        changed += int(_gh_try_ids(page, ["state", "State", "province"], profile.state))
    if profile.postal_code:
        changed += int(_gh_try_ids(page, ["zip", "postal_code", "postcode"], profile.postal_code))
    if profile.country:
        # Some Greenhouse forms expose a country text input
        changed += int(_gh_try_ids(page, ["country", "Country"], profile.country))

    # ── 5. LinkedIn / Portfolio ─────────────────────────────────────────────
    if profile.linkedin:
        changed += int(_gh_try_ids(page, _GH_LINKEDIN, profile.linkedin))
    if profile.website:
        changed += int(_gh_try_ids(page, _GH_PORTFOLIO, profile.website))

    # ── 6. Current employer / title ─────────────────────────────────────────
    if profile.current_company:
        changed += int(_gh_try_ids(page, ["current_company", "current-company", "employer"], profile.current_company))
    if profile.current_title:
        changed += int(_gh_try_ids(page, ["current_title", "current-title", "job_title", "title"], profile.current_title))

    # ── 7. Custom questions (Greenhouse's flexible question builder) ─────────
    # Greenhouse renders custom questions under [data-qa="custom-question"] or
    # inside .application-question / .field divs.
    question_containers = page.locator(
        '[data-qa="custom-question"], .application-question, .field--custom, '
        'li.custom-question, .custom-question'
    )
    for i in range(question_containers.count()):
        qc = question_containers.nth(i)
        try:
            if not qc.is_visible():
                continue
            # Extract the question label
            lbl_loc = qc.locator("label, legend, .label, .question-label, [class*='label']").first
            label_text = (lbl_loc.inner_text() if lbl_loc.count() else "").strip()
            if not label_text:
                continue

            # EEO answers take priority over generic answer_for
            ans = _eeo_answer(label_text, profile) or answer_for(label_text, profile)
            if not ans:
                continue

            # Native <select>
            sel = qc.locator("select").first
            if sel.count() and sel.is_visible():
                options = sel.locator("option").all_text_contents()
                choice = best_option(ans, options)
                if choice:
                    sel.select_option(label=choice)
                    _gh_dispatch(sel)
                    changed += 1
                continue

            # Radio group
            radios = qc.locator("input[type='radio']")
            if radios.count():
                all_radio_labels = []
                for ri in range(radios.count()):
                    r = radios.nth(ri)
                    lbl = r.get_attribute("value") or r.get_attribute("aria-label") or ""
                    # Try associated label text
                    rid = r.get_attribute("id")
                    if rid:
                        assoc = page.locator(f'label[for="{rid}"]')
                        if assoc.count():
                            lbl = assoc.inner_text().strip() or lbl
                    all_radio_labels.append((r, lbl))
                choice = best_option(ans, [lbl for _, lbl in all_radio_labels])
                for r, lbl in all_radio_labels:
                    if lbl == choice:
                        r.check(force=True)
                        _gh_dispatch(r)
                        changed += 1
                        break
                continue

            # Checkbox
            cb = qc.locator("input[type='checkbox']").first
            if cb.count() and cb.is_visible():
                if normalize(ans) in {"yes", "true", "1"} and not cb.is_checked():
                    cb.check(force=True)
                    changed += 1
                continue

            # Textarea / text input
            ti = qc.locator("textarea, input[type='text'], input[type='email'], input[type='url'], input:not([type])").first
            if ti.count() and ti.is_visible() and ti.is_enabled():
                existing = (ti.input_value() or "").strip()
                if not existing:
                    ti.fill(ans)
                    _gh_dispatch(ti)
                    changed += 1
        except Exception:
            continue

    # ── 8. Authorization / sponsorship / salary top-level fields ────────────
    # Some Greenhouse boards surface these as top-level <select> or radio.
    def _fill_top_level_select(label_pattern: str, answer: str | None) -> None:
        nonlocal changed
        if not answer:
            return
        # Inline label extraction to avoid circular import with browser.py
        _LABEL_SCRIPT = (
            "el => { "
            "const clean = s => (s || '').replace(/\\s+/g, ' ').trim(); "
            "const labelled = (el.getAttribute('aria-labelledby') || '').split(/\\s+/)"
            ".map(id => document.getElementById(id)?.innerText || '').join(' '); "
            "const explicit = el.id ? document.querySelector(`label[for='${CSS.escape(el.id)}']`)?.innerText : ''; "
            "const wrapping = el.closest('label')?.innerText || ''; "
            "const group = el.closest('fieldset, [role=\'group\'], .field, .application-question'); "
            "const groupLabel = group?.querySelector('legend, label, [class*=\'label\']')?.innerText || ''; "
            "return clean(labelled || el.getAttribute('aria-label') || explicit || groupLabel || wrapping || "
            "el.getAttribute('placeholder') || el.getAttribute('name') || ''); "
            "}"
        )
        for sel_loc in page.locator("select").all():
            try:
                if not sel_loc.is_visible():
                    continue
                lbl = sel_loc.evaluate(_LABEL_SCRIPT)
                if re.search(label_pattern, lbl, re.I):
                    options = sel_loc.locator("option").all_text_contents()
                    choice = best_option(answer, options)
                    if choice:
                        sel_loc.select_option(label=choice)
                        _gh_dispatch(sel_loc)
                        changed += 1
            except Exception:
                continue

    # Work authorization
    _fill_top_level_select(
        r"authorized|work authorization|legally authorized",
        boolean_text(profile.authorized_to_work)
    )
    # Sponsorship
    _fill_top_level_select(
        r"sponsorship|visa sponsor",
        boolean_text(profile.requires_sponsorship)
    )
    # Salary
    if profile.minimum_salary:
        _fill_top_level_select(r"salary|compensation|pay", profile.minimum_salary)

    return changed


def is_greenhouse_url(url: str) -> bool:
    """Return True if the URL is served by Greenhouse."""
    try:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
        return (
            host == "boards.greenhouse.io"
            or host == "job-boards.greenhouse.io"
            or host.endswith(".greenhouse.io")
        )
    except Exception:
        return False
