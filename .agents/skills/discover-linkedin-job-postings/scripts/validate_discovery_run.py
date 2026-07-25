#!/usr/bin/env python3
"""Validate an auditable LinkedIn discovery run and its JobPosting artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


DECISIONS = {"FORWARD", "MANUAL_REVIEW", "SKIP_FIRST_LEVEL"}
COLLECTION_STATUSES = {
    "not_requested",
    "skipped_before_detail",
    "retrieved",
    "cached",
    "retrieval_failed",
}


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def require_keys(value: dict, keys: set[str], label: str) -> None:
    missing = sorted(keys - value.keys())
    if missing:
        raise ValueError(f"{label} is missing: {', '.join(missing)}")


def validate_jobposting(path: Path) -> None:
    posting = load_json(path)
    require_keys(
        posting,
        {"@context", "@type", "title", "hiringOrganization", "description", "url"},
        str(path),
    )
    if posting["@type"] != "JobPosting":
        raise ValueError(f"{path}: @type must be JobPosting")
    organization = posting["hiringOrganization"]
    if not isinstance(organization, dict) or not organization.get("name"):
        raise ValueError(f"{path}: hiringOrganization.name is required")
    for key in ("title", "description", "url"):
        if not isinstance(posting[key], str) or not posting[key].strip():
            raise ValueError(f"{path}: {key} must be a non-empty string")


def validate_manifest(path: Path) -> dict:
    manifest = load_json(path)
    require_keys(
        manifest,
        {
            "schema_version",
            "run_id",
            "candidate_id",
            "source",
            "trigger",
            "started_at",
            "query_portfolio_path",
            "policy_path",
            "filter_verification",
            "jobs",
            "metrics",
            "warnings",
        },
        "run manifest",
    )
    if manifest["source"] != "linkedin":
        raise ValueError("run manifest source must be linkedin")
    if not isinstance(manifest["jobs"], list):
        raise ValueError("run manifest jobs must be an array")

    run_dir = path.parent
    seen_ids: set[str] = set()
    counts = {
        "cards_discovered": len(manifest["jobs"]),
        "details_skipped": 0,
        "details_retrieved": 0,
        "cache_hits": 0,
        "retrieval_failed": 0,
    }

    for index, job in enumerate(manifest["jobs"]):
        label = f"jobs[{index}]"
        if not isinstance(job, dict):
            raise ValueError(f"{label} must be an object")
        require_keys(
            job,
            {
                "job_id",
                "title",
                "company",
                "canonical_url",
                "query_ids",
                "first_level_decision",
                "reason_codes",
                "collection_status",
            },
            label,
        )
        job_id = str(job["job_id"])
        if job_id in seen_ids:
            raise ValueError(f"duplicate job_id: {job_id}")
        seen_ids.add(job_id)
        if job["first_level_decision"] not in DECISIONS:
            raise ValueError(f"{label}: invalid first_level_decision")
        status = job["collection_status"]
        if status not in COLLECTION_STATUSES:
            raise ValueError(f"{label}: invalid collection_status")

        if status == "skipped_before_detail":
            counts["details_skipped"] += 1
        elif status == "retrieved":
            counts["details_retrieved"] += 1
        elif status == "cached":
            counts["details_retrieved"] += 1
            counts["cache_hits"] += 1
        elif status == "retrieval_failed":
            counts["retrieval_failed"] += 1

        if status in {"retrieved", "cached"}:
            require_keys(job, {"jobposting_json", "jobposting_markdown"}, label)
            json_path = (run_dir / job["jobposting_json"]).resolve()
            markdown_path = (run_dir / job["jobposting_markdown"]).resolve()
            try:
                json_path.relative_to(run_dir.resolve())
                markdown_path.relative_to(run_dir.resolve())
            except ValueError as exc:
                raise ValueError(f"{label}: artifact paths must stay inside the run directory") from exc
            if not json_path.is_file() or not markdown_path.is_file():
                raise ValueError(f"{label}: referenced JobPosting artifacts do not exist")
            validate_jobposting(json_path)

    require_keys(manifest["metrics"], set(counts), "metrics")
    for key, expected in counts.items():
        if manifest["metrics"][key] != expected:
            raise ValueError(
                f"metrics.{key} is {manifest['metrics'][key]!r}; expected {expected}"
            )

    return {"run_id": manifest["run_id"], "jobs": len(manifest["jobs"]), "valid": True}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    result = validate_manifest(args.manifest.resolve())
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
