from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from .profile import CandidateProfile


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def boolean_text(value: bool | None) -> str | None:
    return None if value is None else ("Yes" if value else "No")


def answer_for(label: str, profile: CandidateProfile) -> str | None:
    q = normalize(label)
    # Exact user-provided question answers have priority.
    for question, answer in profile.explicit_answers.items():
        if normalize(str(question)) == q and answer is not None:
            return str(answer)
    fields: list[tuple[tuple[str, ...], Any]] = [
        (("first name", "given name"), profile.first_name),
        (("last name", "family name", "surname"), profile.last_name),
        (("full name",), profile.full_name),
        (("email",), profile.email),
        (("phone", "mobile"), profile.phone),
        (("address line 1", "street address", "address"), profile.address),
        (("city",), profile.city),
        (("state", "province", "territory", "region"), profile.state),
        (("zip", "postal code"), profile.postal_code),
        (("country",), profile.country),
        (("linkedin",), profile.linkedin),
        (("github",), profile.github),
        (("portfolio", "personal website", "website"), profile.website),
        (("current company", "employer"), profile.current_company),
        (("current title", "job title"), profile.current_title),
        (("minimum salary", "salary requirement", "salary expectation"), profile.minimum_salary),
        (("security clearance", "ts sci", "clearance"), profile.security_clearance),
        (("citizen", "citizenship"), profile.citizenship),
        (("authorized to work", "legally authorized", "work authorization"), boolean_text(profile.authorized_to_work)),
        (("sponsorship", "sponsor"), boolean_text(profile.requires_sponsorship)),
        (("relocate", "relocation"), boolean_text(profile.willing_to_relocate)),
        (("background check",), boolean_text(profile.background_check_consent)),
        (("disability", "disabilities", "handicap", "voluntary self identification of disability"), profile.disability_status),
    ]
    # Specific rules must beat generic address/country-like labels.
    for keywords, value in reversed(fields):
        if value not in (None, "") and any(keyword in q for keyword in keywords):
            return str(value)
    return None


def best_option(answer: str, options: list[str]) -> str | None:
    wanted = normalize(answer)
    cleaned = [(option, normalize(option)) for option in options if normalize(option) not in {"", "select", "select one"}]
    for original, value in cleaned:
        if value == wanted:
            return original

    # Handle standard ATS Disability Self-Identification options
    if "disability" in wanted or "no i don t have a disability" in wanted:
        if "no" in wanted or "don t" in wanted:
            for original, value in cleaned:
                if "no" in value and ("disability" in value or "history" in value or "record" in value):
                    return original
                if value in {"no", "no i do not have a disability", "i do not have a disability"}:
                    return original
        elif "yes" in wanted:
            for original, value in cleaned:
                if "yes" in value and "disability" in value:
                    return original
                if value == "yes":
                    return original
        elif "decline" in wanted or "wish" in wanted:
            for original, value in cleaned:
                if "wish" in value or "decline" in value or "prefer not" in value:
                    return original

    # ── Veteran keyword pre-pass ─────────────────────────────────────────────────
    # When the desired answer is "I am a veteran" (or equivalent), find the
    # option that affirms veteran status rather than denies or declines it.
    # Veteran option forms vary wildly across ATS platforms.
    _AFFIRM_VETERAN = {
        "i am a veteran",
        "veteran",
        "i identify as one or more of the classifications of a protected veteran",
        "protected veteran",
        "i am a protected veteran",
        "am a veteran",
    }
    _DENY_VETERAN = {
        "i am not a veteran",
        "i am not a protected veteran",
        "not a protected veteran",
        "not a veteran",
        "no",
    }
    if wanted in _AFFIRM_VETERAN or "i am a veteran" in wanted:
        # Look for the option that affirms veteran status
        for original, value in cleaned:
            if value in _AFFIRM_VETERAN:
                return original
            if "veteran" in value and "not" not in value and "decline" not in value and "wish" not in value:
                return original

    aliases = {
        "true": "yes", "false": "no", "y": "yes", "n": "no",
        "usa": "united states", "us": "united states",
        # Veteran affirm: all known ATS form labels → normalised key
        "i am a veteran": "veteran_affirm",
        "veteran": "veteran_affirm",
        "i am a protected veteran": "veteran_affirm",
        "protected veteran": "veteran_affirm",
        "i identify as one or more of the classifications of a protected veteran": "veteran_affirm",
        "i identify as a protected veteran": "veteran_affirm",
        "am a veteran": "veteran_affirm",
        # Veteran deny
        "i am not a veteran": "veteran_deny",
        "i am not a protected veteran": "veteran_deny",
        "not a protected veteran": "veteran_deny",
        "not a veteran": "veteran_deny",
        # Veteran decline
        "i don t wish to answer": "veteran_decline",
        "decline to self identify": "veteran_decline",
        "decline to self-identify": "veteran_decline",
    }
    wanted_alias = aliases.get(wanted, wanted)
    for original, value in cleaned:
        alias_val = aliases.get(value, value)
        if alias_val == wanted_alias:
            return original

    ranked = sorted(((SequenceMatcher(None, wanted, value).ratio(), original) for original, value in cleaned), reverse=True)
    return ranked[0][1] if ranked and ranked[0][0] >= 0.70 else None


def find_best_country_option(answer: str, options: list[str]) -> str | None:
    """Find the best matching country option from a list of options.
    
    Handles cases like "+1 United States" matching "United States +1" by checking
    both the dial code and country names.
    """
    wanted = normalize(answer)
    
    # Try exact match first
    for opt in options:
        if normalize(opt) == wanted:
            return opt

    # Extract digits (dial code) and words (country name) from wanted
    wanted_digits = "".join(c for c in answer if c.isdigit())
    wanted_words = re.sub(r"\+\d+|\b\d+\b", "", answer).strip()
    w_words_norm = normalize(wanted_words)

    aliases = {
        "us": "united states",
        "usa": "united states",
        "uk": "united kingdom",
        "ca": "canada",
    }
    w_words_norm = aliases.get(w_words_norm, w_words_norm)

    scored_options = []
    for opt in options:
        opt_norm = normalize(opt)
        opt_digits = "".join(c for c in opt if c.isdigit())
        opt_words = re.sub(r"\+\d+|\b\d+\b", "", opt).strip()
        o_words_norm = normalize(opt_words)
        o_words_norm = aliases.get(o_words_norm, o_words_norm)
        
        score = 0
        # If dial code matches exactly
        if wanted_digits and opt_digits and wanted_digits == opt_digits:
            score += 5
            
        # If country words match exactly
        if w_words_norm and o_words_norm and w_words_norm == o_words_norm:
            score += 10
        # If one country word is a substring of the other
        elif w_words_norm and o_words_norm and (w_words_norm in o_words_norm or o_words_norm in w_words_norm):
            score += 5
            
        if score > 0:
            scored_options.append((score, opt))
            
    if scored_options:
        scored_options.sort(key=lambda x: x[0], reverse=True)
        return scored_options[0][1]
        
    return None
