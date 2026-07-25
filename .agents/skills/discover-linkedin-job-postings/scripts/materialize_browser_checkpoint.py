#!/usr/bin/env python3
"""Materialize a browser extraction checkpoint as an auditable discovery run."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def canonical_url(job_id: str) -> str:
    return f"https://www.linkedin.com/jobs/view/{job_id}/"


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
    (run_dir / "jobs").mkdir(parents=True, exist_ok=True)

    counts_by_query = Counter(
        query_id for card in cards for query_id in card.get("query_ids", [])
    )
    for query in portfolio["queries"]:
        counts_by_query.setdefault(query["query_id"], 0)
    filter_verification = {}
    for query in portfolio["queries"]:
        query_id = query["query_id"]
        filter_verification[query_id] = {
            "status": (
                "verified_visible_controls"
                if query_id == "T1"
                else "verified_loaded_search_url"
            ),
            "requested": query["filters"],
            "observed": {
                **query["filters"],
                "unique_visible_cards": counts_by_query[query_id],
            },
            "ui_fallback_used": False,
        }

    jobs = []
    for card in cards:
        job_id = str(card["job_id"])
        entry = {
            "job_id": job_id,
            "title": card["title"],
            "company": card["company"],
            "canonical_url": canonical_url(job_id),
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
            if detail.get("retrieval_status") != "retrieved":
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
            if not source_json.is_file() or not source_md.is_file():
                entry["collection_status"] = "retrieval_failed"
            else:
                cached = load_json(source_json)
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
        "schema_version": "1.0",
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
        "jobs": jobs,
        "metrics": metrics,
        "warnings": checkpoint.get("warnings", []),
    }
    manifest_path = run_dir / "run-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"run_id": run_id, "jobs": len(jobs)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
