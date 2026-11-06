#!/usr/bin/env python3
"""Materialize a browser extraction checkpoint as an auditable discovery run."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def canonical_url(job_id: str) -> str:
    return f"https://www.linkedin.com/jobs/view/{job_id}/"


def has_collapsed_marker(value: object) -> bool:
    return bool(re.search(
        r"(?:\u2026|\.\.\.)?\s*(?:show more|see more|more|mehr anzeigen)\s*$",
        str(value or "").strip(),
        re.IGNORECASE,
    ))


def failed_review_entry(card: dict, detail: dict | None) -> dict:
    job_id = str(card["job_id"])
    warnings = list((detail or {}).get("extraction_warnings", []))
    if not warnings:
        warnings = ["DETAIL_NOT_RETRIEVED_AND_CACHE_MISS"]
    return {
        "job_id": job_id,
        "title": card["title"],
        "company": card["company"],
        "location": card.get("location", ""),
        "canonical_url": canonical_url(job_id),
        "source_url": card.get("source_url") or canonical_url(job_id),
        "review_url": canonical_url(job_id),
        "query_ids": card.get("query_ids", []),
        "first_level_decision": card["first_level_decision"],
        "reason_codes": card.get("reason_codes", []),
        "retrieval_warnings": warnings,
        "partial_description": (detail or {}).get("description", "").strip(),
    }


def failed_review_markdown(run_id: str, failed_jobs: list[dict]) -> str:
    lines = [
        "# Failed job-description retrievals",
        "",
        f"- Run ID: {run_id}",
        f"- Jobs requiring manual review: {len(failed_jobs)}",
        "",
    ]
    if not failed_jobs:
        lines.extend(["No failed job-description retrievals.", ""])
        return "\n".join(lines)

    for job in failed_jobs:
        lines.extend(
            [
                f"## {job['title']} - {job['company']}",
                "",
                f"- [Open LinkedIn job]({job['review_url']})",
                f"- Job ID: {job['job_id']}",
                f"- Location: {job['location'] or 'Not captured'}",
                f"- Query IDs: {', '.join(job['query_ids']) or 'Not captured'}",
                f"- Failure codes: {', '.join(job['retrieval_warnings'])}",
                f"- Captured source URL: {job['source_url']}",
                "",
            ]
        )
        if job["partial_description"]:
            lines.extend(
                [
                    "### Partially captured description",
                    "",
                    job["partial_description"],
                    "",
                ]
            )
    return "\n".join(lines)


def write_failed_review_artifacts(
    run_dir: Path, run_id: str, failed_jobs: list[dict]
) -> dict:
    json_rel = "failed-jobs.json"
    markdown_rel = "failed-jobs.md"
    payload = {
        "schema_version": "1.0",
        "run_id": run_id,
        "source": "linkedin",
        "jobs": failed_jobs,
    }
    (run_dir / json_rel).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (run_dir / markdown_rel).write_text(
        failed_review_markdown(run_id, failed_jobs),
        encoding="utf-8",
    )
    return {"json": json_rel, "markdown": markdown_rel, "count": len(failed_jobs)}


def markdown(posting: dict) -> str:
    organization = posting["hiringOrganization"]["name"]
    location = (
        posting.get("jobLocation", {})
        .get("address", {})
        .get("addressLocality", "")
    )
    lines = [
        f"# {posting['title']}",
        "",
        f"- Company: {organization}",
        f"- Location: {location or 'Not captured'}",
        f"- Source: {posting['url']}",
        "",
        "## Job description",
        "",
        posting["description"].strip(),
        "",
    ]
    return "\n".join(lines)


def posting_from_detail(detail: dict, run_id: str) -> dict:
    job_id = str(detail["job_id"])
    retrieval_method = detail.get("retrieval_method")
    if not retrieval_method:
        selection_mode = detail.get("selection", {}).get("mode")
        retrieval_method = (
            "search_split_pane_currentJobId"
            if selection_mode == "currentJobId_url"
            else "visible_authenticated_browser"
        )
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": detail["title"],
        "hiringOrganization": {
            "@type": "Organization",
            "name": detail["company"],
        },
        "description": detail["description"].strip(),
        "url": canonical_url(job_id),
        "discovery": {
            "run_id": run_id,
            "job_id": job_id,
            "query_ids": detail.get("query_ids", []),
            "source": "linkedin",
            "retrieval_method": retrieval_method,
            "extraction_warnings": detail.get("extraction_warnings", []),
            "description_completeness": detail.get("description_completeness"),
            "description_expansion": detail.get("description_expansion"),
        },
    }
    if detail.get("location"):
        posting["jobLocation"] = {
            "@type": "Place",
            "address": {
                "@type": "PostalAddress",
                "addressLocality": detail["location"],
            },
        }
    return posting


def write_posting(run_dir: Path, posting: dict) -> tuple[str, str]:
    job_id = str(posting["discovery"]["job_id"])
    json_rel = f"jobs/{job_id}.json"
    md_rel = f"jobs/{job_id}.md"
    (run_dir / json_rel).write_text(
        json.dumps(posting, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (run_dir / md_rel).write_text(markdown(posting), encoding="utf-8")
    return json_rel, md_rel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--portfolio", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--cache-run", type=Path, required=True)
    args = parser.parse_args()

    checkpoint_path = args.checkpoint.resolve()
    run_dir = checkpoint_path.parent
    checkpoint = load_json(checkpoint_path)
    portfolio = load_json(args.portfolio.resolve())
    run_id = checkpoint["run_id"]
    cards = checkpoint["cards"]
    details = {str(item["job_id"]): item for item in checkpoint["details"]}
    requested_detail_ids = {
        str(job_id) for job_id in checkpoint.get("detail_requested_job_ids", [])
    }
    has_requested_detail_ids = "detail_requested_job_ids" in checkpoint
    (run_dir / "jobs").mkdir(parents=True, exist_ok=True)

    counts_by_query = Counter(
        query_id for card in cards for query_id in card.get("query_ids", [])
    )
    for query in portfolio["queries"]:
        counts_by_query.setdefault(query["query_id"], 0)
    filter_verification = dict(checkpoint.get("filter_verification", {}))
    for query in portfolio["queries"]:
        query_id = query["query_id"]
        filter_verification.setdefault(
            query_id,
            {
                "status": "verification_missing",
                "requested": query["filters"],
                "observed": {
                    "unique_visible_cards": counts_by_query[query_id],
                },
                "ui_fallback_used": False,
                "warnings": ["FILTER_VERIFICATION_MISSING_FROM_CHECKPOINT"],
            },
        )

    jobs = []
    for card in cards:
        job_id = str(card["job_id"])
        entry = {
            "job_id": job_id,
            "title": card["title"],
            "company": card["company"],
            "location": card.get("location", ""),
            "canonical_url": canonical_url(job_id),
            "source_url": card.get("source_url") or canonical_url(job_id),
            "query_ids": card.get("query_ids", []),
            "first_level_decision": card["first_level_decision"],
            "reason_codes": card.get("reason_codes", []),
        }
        if card.get("matched_markers"):
            entry["matched_markers"] = card["matched_markers"]

        if card["first_level_decision"] == "SKIP_FIRST_LEVEL":
            entry["collection_status"] = "skipped_before_detail"
        elif job_id in details:
            detail = details[job_id]
            if detail.get("retrieval_status") != "retrieved" or has_collapsed_marker(detail.get("description")):
                entry["collection_status"] = "retrieval_failed"
            else:
                posting = posting_from_detail(detail, run_id)
                json_rel, md_rel = write_posting(run_dir, posting)
                entry.update(
                    {
                        "collection_status": "retrieved",
                        "jobposting_json": json_rel,
                        "jobposting_markdown": md_rel,
                        "retrieval_method": posting["discovery"]["retrieval_method"],
                    }
                )
        else:
            source_json = args.cache_run.resolve() / "jobs" / f"{job_id}.json"
            source_md = args.cache_run.resolve() / "jobs" / f"{job_id}.md"
            if has_requested_detail_ids and job_id not in requested_detail_ids:
                entry["collection_status"] = "not_requested"
            elif not source_json.is_file() or not source_md.is_file():
                entry["collection_status"] = "retrieval_failed"
            else:
                cached = load_json(source_json)
                if has_collapsed_marker(cached.get("description")) or cached.get("discovery", {}).get("description_completeness", "").startswith("incomplete_"):
                    entry["collection_status"] = "retrieval_failed"
                    jobs.append(entry)
                    continue
                cached.setdefault("discovery", {}).update(
                    {
                        "run_id": run_id,
                        "job_id": job_id,
                        "query_ids": card.get("query_ids", []),
                        "source": "linkedin",
                        "retrieval_method": "cache_hit",
                    }
                )
                json_rel, md_rel = write_posting(run_dir, cached)
                entry.update(
                    {
                        "collection_status": "cached",
                        "jobposting_json": json_rel,
                        "jobposting_markdown": md_rel,
                    }
                )
        jobs.append(entry)

    cards_by_id = {str(card["job_id"]): card for card in cards}
    failed_jobs = []
    for entry in jobs:
        if entry["collection_status"] != "retrieval_failed":
            continue
        job_id = entry["job_id"]
        failed = failed_review_entry(cards_by_id[job_id], details.get(job_id))
        failed_jobs.append(failed)
        entry.update(
            {
                "manual_review_required": True,
                "review_url": failed["review_url"],
                "retrieval_warnings": failed["retrieval_warnings"],
            }
        )

    failed_jobs_review = write_failed_review_artifacts(run_dir, run_id, failed_jobs)

    metrics = {
        "cards_discovered": len(jobs),
        "details_skipped": sum(
            item["collection_status"] == "skipped_before_detail" for item in jobs
        ),
        "details_retrieved": sum(
            item["collection_status"] in {"retrieved", "cached"} for item in jobs
        ),
        "cache_hits": sum(item["collection_status"] == "cached" for item in jobs),
        "retrieval_failed": sum(
            item["collection_status"] == "retrieval_failed" for item in jobs
        ),
        "new_details_retrieved": sum(
            item["collection_status"] == "retrieved" for item in jobs
        ),
        "query_visible_card_counts": dict(sorted(counts_by_query.items())),
    }
    manifest = {
        "schema_version": "1.2",
        "run_id": run_id,
        "candidate_id": portfolio["candidate_id"],
        "source": "linkedin",
        "run_profile": portfolio.get("run_profile", "capability_test"),
        "collection_limit": portfolio.get("collection_limit"),
        "trigger": {"type": "manual", "id": run_id},
        "started_at": checkpoint["captured_at"],
        "query_portfolio_path": str(args.portfolio.resolve()),
        "policy_path": str(args.policy.resolve()),
        "filter_verification": filter_verification,
        "query_progress": checkpoint.get("query_progress", {}),
        "jobs": jobs,
        "failed_jobs_review": failed_jobs_review,
        "metrics": metrics,
        "warnings": checkpoint.get("warnings", []),
        "stop_reason": checkpoint.get("stop_reason"),
        "extraction_stopped": bool(checkpoint.get("extraction_stopped", False)),
    }
    manifest_path = run_dir / "run-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"run_id": run_id, "jobs": len(jobs)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
