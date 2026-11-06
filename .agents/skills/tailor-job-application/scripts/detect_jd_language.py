#!/usr/bin/env python3
"""Deterministically identify predominantly German job-description prose."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DETECTOR_VERSION = "german-jd-v1"

GERMAN_MARKERS = {
    "aber", "als", "auch", "auf", "aufgaben", "ausbildung", "bei", "bewerbung",
    "deine", "deinen", "deiner", "den", "der", "des", "die", "ein", "eine",
    "einen", "einer", "erfahrung", "für", "ihre", "ihren", "ihrer", "im",
    "kenntnisse", "mit", "oder", "sowie", "studium", "und", "unser", "unsere",
    "verantwortung", "von", "wir", "zu", "über",
}
GERMAN_STRONG_MARKERS = {
    "aufgaben", "ausbildung", "bewerbung", "deine", "deinen", "deiner", "erfahrung",
    "für", "ihre", "ihren", "ihrer", "kenntnisse", "sowie", "studium", "unser",
    "unsere", "verantwortung", "über",
}
ENGLISH_MARKERS = {
    "and", "are", "as", "at", "candidate", "degree", "experience", "for", "from",
    "in", "including", "is", "job", "knowledge", "of", "or", "our", "requirements",
    "responsibilities", "role", "skills", "the", "to", "we", "with", "you", "your",
}


def analyze_jd_language(text: str) -> dict:
    words = re.findall(r"[A-Za-zÄÖÜäöüß]+", re.sub(r"<[^>]+>", " ", text or "").lower())
    german_hits = sum(word in GERMAN_MARKERS for word in words)
    german_strong_hits = sum(word in GERMAN_STRONG_MARKERS for word in words)
    english_hits = sum(word in ENGLISH_MARKERS for word in words)
    german_ratio = german_hits / len(words) if words else 0.0
    is_german = (
        len(words) >= 50
        and german_strong_hits >= 4
        and german_hits >= 10
        and german_ratio >= 0.08
        and german_hits >= english_hits * 1.4
    )
    evidence_terms = sorted({word for word in words if word in GERMAN_STRONG_MARKERS})[:12]
    return {
        "detector_version": DETECTOR_VERSION,
        "language": "de" if is_german else "not_de",
        "is_german": is_german,
        "word_count": len(words),
        "german_marker_hits": german_hits,
        "german_strong_marker_hits": german_strong_hits,
        "english_marker_hits": english_hits,
        "german_marker_ratio": round(german_ratio, 4),
        "evidence_terms": evidence_terms,
        "reason_code": "JD_LANGUAGE_GERMAN" if is_german else None,
    }


def description_from_path(path: Path) -> str:
    if path.suffix.lower() == ".json":
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("description"), str):
            raise ValueError("JobPosting JSON must contain a string description")
        return value["description"]
    return path.read_text(encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="JobPosting JSON or plain-text JD")
    args = parser.parse_args()
    result = analyze_jd_language(description_from_path(args.input))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
