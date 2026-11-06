#!/usr/bin/env python3
"""Validate an auditable LinkedIn discovery run and its JobPosting artifacts."""

from __future__ import annotations

import argparse
import json
import re
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
    if re.search(r"(?:\u2026|\.\.\.)?\s*(?:show more|see more|more|mehr anzeigen)\s*$", posting["description"], re.IGNORECASE):
        raise ValueError(f"{path}: description retains a collapsed marker")
    completeness = posting.get("discovery", {}).get("description_completeness")
    if isinstance(completeness, str) and completeness.startswith("incomplete_"):
        raise ValueError(f"{path}: extraction metadata reports an incomplete description")
    expansion = posting.get("discovery", {}).get("description_expansion") or {}
    if expansion.get("outcome") in {"failed", "ambiguous_control", "marker_without_control"}:
        raise ValueError(f"{path}: description expansion was not verified")


def resolve_run_artifact(run_dir: Path, relative_path: str, label: str) -> Path:
    path = (run_dir / relative_path).resolve()
    try:
        path.relative_to(run_dir.resolve())
    except ValueError as exc:
        raise ValueError(f"{label}: artifact path must stay inside the run directory") from exc
    if not path.is_file():
        raise ValueError(f"{label}: referenced artifact does not exist")
    return path


def validate_failed_jobs_review(manifest: dict, run_dir: Path, failed_ids: set[str]) -> None:
    review = manifest.get("failed_jobs_review")
    if not isinstance(review, dict):
        raise ValueError("schema 1.1 run manifest requires failed_jobs_review")
    require_keys(review, {"json", "markdown", "count"}, "failed_jobs_review")
    if review["count"] != len(failed_ids):
        raise ValueError("failed_jobs_review.count must match retrieval_failed jobs")

    json_path = resolve_run_artifact(run_dir, review["json"], "failed_jobs_review.json")
    markdown_path = resolve_run_artifact(
        run_dir, review["markdown"], "failed_jobs_review.markdown"
    )
    payload = load_json(json_path)
    require_keys(payload, {"schema_version", "run_id", "source", "jobs"}, str(json_path))
    if payload["run_id"] != manifest["run_id"] or payload["source"] != "linkedin":
        raise ValueError("failed-jobs.json run_id/source must match the run manifest")
    if not isinstance(payload["jobs"], list):
        raise ValueError("failed-jobs.json jobs must be an array")

    review_ids: set[str] = set()
    markdown_text = markdown_path.read_text(encoding="utf-8")
    for index, job in enumerate(payload["jobs"]):
        label = f"failed-jobs.json jobs[{index}]"
        require_keys(
            job,
            {
                "job_id",
                "title",
                "company",
                "location",
                "canonical_url",
                "source_url",
                "review_url",
                "query_ids",
                "first_level_decision",
                "reason_codes",
                "retrieval_warnings",
                "partial_description",
            },
            label,
        )
        job_id = str(job["job_id"])
        review_ids.add(job_id)
        if not isinstance(job["review_url"], str) or not job["review_url"].strip():
            raise ValueError(f"{label}: review_url must be a non-empty string")
        if not isinstance(job["retrieval_warnings"], list) or not job["retrieval_warnings"]:
            raise ValueError(f"{label}: retrieval_warnings must be a non-empty array")
        if job["review_url"] not in markdown_text:
            raise ValueError(f"{label}: review URL is missing from failed-jobs.md")
    if review_ids != failed_ids:
        raise ValueError("failed-jobs.json IDs must match retrieval_failed jobs")


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
    requires_failed_review = str(manifest["schema_version"]) != "1.0"
    requires_query_progress = str(manifest["schema_version"]) == "1.2"
    if requires_query_progress:
        require_keys(manifest, {"query_progress", "stop_reason", "extraction_stopped"}, "run manifest")
        if not isinstance(manifest["query_progress"], dict):
            raise ValueError("run manifest query_progress must be an object")
        for query_id, progress in manifest["query_progress"].items():
            if not isinstance(progress, dict):
                raise ValueError(f"query_progress.{query_id} must be an object")
            require_keys(
                progress,
                {"status", "pages_observed", "unique_cards_collected", "stop_reason"},
                f"query_progress.{query_id}",
            )
    seen_ids: set[str] = set()
    failed_ids: set[str] = set()
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
            failed_ids.add(job_id)
            if requires_failed_review:
                require_keys(
                    job,
                    {"manual_review_required", "review_url", "retrieval_warnings"},
                    label,
                )
                if job["manual_review_required"] is not True:
                    raise ValueError(f"{label}: manual_review_required must be true")
                if not isinstance(job["review_url"], str) or not job["review_url"].strip():
                    raise ValueError(f"{label}: review_url must be a non-empty string")
                if not isinstance(job["retrieval_warnings"], list) or not job["retrieval_warnings"]:
                    raise ValueError(f"{label}: retrieval_warnings must be a non-empty array")

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

    if requires_failed_review:
        validate_failed_jobs_review(manifest, run_dir, failed_ids)

    return {"run_id": manifest["run_id"], "jobs": len(manifest["jobs"]), "valid": True}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    result = validate_manifest(args.manifest.resolve())
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
