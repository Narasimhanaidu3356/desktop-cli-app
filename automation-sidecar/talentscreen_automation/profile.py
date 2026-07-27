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
    if isinstance(raw, dict):
        address = _text(raw.get("address") or raw.get("address1"))
        city = _text(raw.get("city"))
        state = _text(raw.get("region") or raw.get("state"))
        postal = _text(raw.get("postalCode") or raw.get("postal_code") or raw.get("zip"))
        country = _text(raw.get("countryCode") or raw.get("country"))
    else:
        address, city, state, postal, country = _text(raw), "", "", "", ""
    # Safely extract common "City, ST 12345" forms without inventing data.
    match = re.fullmatch(r"\s*([^,]+),\s*([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?\s*", address)
    if match:
        city = city or match.group(1)
        state = state or match.group(2)
        postal = postal or (match.group(3) or "")
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
    for item in profiles:
        if isinstance(item, dict) and "linkedin" in _text(item.get("network")).lower():
            linkedin = linkedin or _text(item.get("url"))
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
        linkedin=linkedin, website=website,
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
