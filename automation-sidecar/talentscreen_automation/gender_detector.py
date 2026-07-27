"""Gender detection from name using gender-guesser.

Purged spaCy NER and PDF text parsing to avoid heavy imports/dependencies
that take several minutes to compile or block startup inside frozen exes.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Decoupled Lazy-load libraries
# ---------------------------------------------------------------------------

_gender_detector = None    # type: ignore[assignment]
_gender_checked = False


def _ensure_gender_detector() -> bool:
    """Load gender-guesser detector. This is very fast."""
    global _gender_detector, _gender_checked
    if _gender_checked:
        return _gender_detector is not None
    _gender_checked = True
    try:
        import gender_guesser.detector as gd  # noqa: PLC0415
        _gender_detector = gd.Detector(case_sensitive=False)
    except Exception as exc:
        logger.warning(
            "gender_guesser not available — gender detection from name disabled. "
            "Run: pip install gender-guesser\n"
            f"  Detail: {exc}"
        )
    return _gender_detector is not None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# Mapping from gender_guesser output → ATS-compatible EEO label.
# Keys that are absent (andy, unknown) intentionally map to None so the
# caller can decide to use "Decline To Self Identify".
_GENDER_MAP: dict[str, str] = {
    "male":         "Male",
    "mostly_male":  "Male",
    "female":       "Female",
    "mostly_female": "Female",
    # "andy" and "unknown" are omitted → return None → caller uses Decline
}


def detect_gender_from_name(first_name: str) -> Optional[str]:
    """Predict gender from a known first name directly.

    Useful when the profile already has ``first_name`` parsed from JSON.
    Returns ``"Male"``, ``"Female"``, or ``None``.
    """
    if not first_name or not first_name.strip():
        return None
    if not _ensure_gender_detector():
        return None
    try:
        raw_gender: str = _gender_detector.get_gender(first_name.strip())  # type: ignore[misc]
        return _GENDER_MAP.get(raw_gender)
    except Exception as exc:
        logger.debug("gender_guesser failed for %r: %s", first_name, exc)
        return None
