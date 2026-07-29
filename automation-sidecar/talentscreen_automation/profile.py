from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from .gender_detector import detect_gender_from_name


class CandidateProfile(BaseModel):
    full_name: str = ""
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""
    country: str = ""
    linkedin: str = ""
    github: str = ""
    website: str = ""
    current_company: str = ""
    current_title: str = ""
    authorized_to_work: bool | None = None
    requires_sponsorship: bool | None = None
    willing_to_relocate: bool | None = None
    background_check_consent: bool | None = None
    minimum_salary: str = ""
    citizenship: str = ""
    security_clearance: str = ""
    disability_status: str = "No, I don't have a disability"
    predicted_gender: str | None = None  # "Male", "Female", or None (→ Decline)
    explicit_answers: dict[str, Any] = Field(default_factory=dict)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _split_name(name: str) -> tuple[str, str]:
    parts = name.split()
    return (parts[0] if parts else "", " ".join(parts[1:]) if len(parts) > 1 else "")


def _location(raw: Any) -> tuple[str, str, str, str, str]:
    address = ""
    city = ""
    state = ""
    postal = ""
    country = ""

    if isinstance(raw, dict):
        address = _text(raw.get("address") or raw.get("address1"))
        city = _text(raw.get("city"))
        state = _text(raw.get("region") or raw.get("state"))
        postal = _text(raw.get("postalCode") or raw.get("postal_code") or raw.get("zip"))
        country = _text(raw.get("countryCode") or raw.get("country"))
    else:
        address = _text(raw)

    # If city is still empty, let's try to extract it from address
    if not city and address:
        parts = [p.strip() for p in address.split(",") if p.strip()]
        if len(parts) == 1:
            city = parts[0]
        elif len(parts) == 2:
            city = parts[0]
            state = state or parts[1]
        elif len(parts) >= 3:
            # If the first part has digits, it is likely a street address, so city is the second part
            has_digits = any(c.isdigit() for c in parts[0])
            if has_digits:
                city = parts[1]
                state = state or parts[2]
            else:
                city = parts[0]
                state = state or parts[1]

    # Clean up state (e.g. if it has zip code like "TX 77001")
    if state:
        state_parts = state.split()
        if len(state_parts) > 1:
            state = state_parts[0]
            if not postal:
                postal = "".join(state_parts[1:])

    return address, city, state, postal, country


def normalize_profile(raw: dict[str, Any], answers: dict[str, Any], fallback_email: str) -> CandidateProfile:
    basics = raw.get("basics") if isinstance(raw.get("basics"), dict) else raw.get("personal", raw)
    basics = basics if isinstance(basics, dict) else {}
    name = _text(basics.get("name") or basics.get("fullName") or basics.get("full_name"))
    first = _text(basics.get("firstName") or basics.get("first_name"))
    last = _text(basics.get("lastName") or basics.get("last_name"))
    if not first and not last:
        first, last = _split_name(name)
    address, city, state, postal, country = _location(basics.get("location") or basics.get("address"))
    profiles = basics.get("profiles") if isinstance(basics.get("profiles"), list) else []
    linkedin = _text(basics.get("linkedin") or basics.get("linkedinUrl"))
    github = _text(basics.get("github") or basics.get("githubUrl"))
    for item in profiles:
        if isinstance(item, dict):
            net = _text(item.get("network")).lower()
            if "linkedin" in net:
                linkedin = linkedin or _text(item.get("url"))
            elif "github" in net:
                github = github or _text(item.get("url"))
    website = _text(basics.get("website") or basics.get("url") or basics.get("portfolio"))
    if "linkedin.com" in website and not linkedin:
        linkedin, website = website, ""
    work = raw.get("work") if isinstance(raw.get("work"), list) else []
    current = work[0] if work and isinstance(work[0], dict) else {}
  

    explicit = raw.get("applicationAnswers") or raw.get("application_answers") or {}
    return CandidateProfile(
        full_name=name or " ".join(filter(None, (first, last))), first_name=first, last_name=last,
        email=_text(basics.get("email")) or fallback_email, phone=_text(basics.get("phone")),
        address=address, city=city, state=state, postal_code=postal, country=country,
        linkedin=linkedin, github=github, website=website,
        current_company=_text(current.get("company") or current.get("name")),
        current_title=_text(current.get("position") or current.get("title")),
        authorized_to_work=answers.get("authorizedToWork"),
        requires_sponsorship=answers.get("requiresSponsorship"),
        willing_to_relocate=answers.get("willingToRelocate"),
        background_check_consent=answers.get("backgroundCheckConsent"),
        minimum_salary=_text(answers.get("minimumSalary")), citizenship=_text(answers.get("citizenship")),
        security_clearance=_text(answers.get("securityClearance")),
        disability_status="No, I don't have a disability",
        predicted_gender=detect_gender_from_name(first),
        explicit_answers=explicit if isinstance(explicit, dict) else {},
    )
