#!/usr/bin/env python3
"""Create a portable job-application case from a verified JobPosting JSON file."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path


LEGAL_SUFFIXES = {"ag", "gmbh", "se", "inc", "ltd", "llc", "plc", "corp", "corporation"}


def slugify(value: str) -> str:
    value = value.translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"}))
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", normalized)).strip("-")


def employer_slug(name: str) -> str:
    words = slugify(name).split("-")
    while words and words[-1] in LEGAL_SUFFIXES:
        words.pop()
    return "-".join(words)


def role_slug(title: str) -> str:
    title = re.sub(r"\([^)]*(?:m|f|d|w)[^)]*\)", "", title, flags=re.IGNORECASE)
    return slugify(title)


def verified_identity(record: dict) -> tuple[str, str]:
    if record.get("@type") != "JobPosting":
        raise ValueError("JSON input is not a schema.org JobPosting record")
    organization = record.get("hiringOrganization") or {}
    employer = (organization.get("name") or organization.get("legalName") or "").strip()
    title = (record.get("title") or "").strip()
    if not employer or not title:
        raise ValueError("Verified employer and role title are required before creating a final case directory")
    return employer, title


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job_json", type=Path)
    parser.add_argument("--cases-root", type=Path, required=True)
    parser.add_argument("--slug", help="Optional reviewed slug; employer is still verified from JobPosting JSON")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    record = json.loads(args.job_json.read_text(encoding="utf-8"))
    employer, title = verified_identity(record)
    generated_slug = f"{employer_slug(employer)}-{role_slug(title)}"
    case_slug = slugify(args.slug) if args.slug else generated_slug
    target = args.cases_root.resolve() / case_slug
    result = {"employer": employer, "role_title": title, "case_slug": case_slug, "target": str(target), "created": False}
    if not args.dry_run:
        if target.exists():
            raise FileExistsError(f"Case already exists: {target}")
        for relative in ("input", "work", "review", "output", "output/pdf"):
            (target / relative).mkdir(parents=True, exist_ok=True)
        result["created"] = True
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
