#!/usr/bin/env python3

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from validate_discovery_run import validate_manifest


SCRIPT = Path(__file__).with_name("materialize_browser_checkpoint.py")


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    run_dir = root / "run"
    cache_dir = root / "cache"
    run_dir.mkdir()
    cache_dir.mkdir()

    portfolio = {
        "schema_version": "1.0",
        "candidate_id": "test-candidate",
        "as_of": "2026-07-26",
        "run_profile": "daily",
        "collection_limit": 10,
        "queries": [
            {
                "query_id": "T1",
                "filters": {
                    "location": "Germany",
                    "date_posted": "Past 24 hours",
                    "employment_type": ["Full-time"],
                    "experience_level": ["Entry level"],
                    "sort_by": "Most recent",
                },
            }
        ],
    }
    checkpoint = {
        "schema_version": "1.0",
        "run_id": "failed-review-test",
        "captured_at": "2026-07-26T20:00:00+02:00",
        "cards": [
            {
                "job_id": "111111111",
                "title": "Business Analyst",
                "company": "Example GmbH",
                "location": "Berlin, Germany",
                "source_url": "https://www.linkedin.com/jobs/view/111111111/?tracking=test",
                "query_ids": ["T1"],
                "first_level_decision": "FORWARD",
                "reason_codes": [],
            },
            {
                "job_id": "222222222",
                "title": "SAP Analyst",
                "company": "Example AG",
                "location": "Munich, Germany",
                "source_url": "https://www.linkedin.com/jobs/view/222222222/?tracking=test",
                "query_ids": ["T1"],
                "first_level_decision": "MANUAL_REVIEW",
                "reason_codes": ["TITLE_REVIEW_SIGNAL"],
            },
            {
                "job_id": "333333333",
                "title": "Finance Analyst",
                "company": "Example Bank",
                "location": "Frankfurt, Germany",
                "source_url": "https://www.linkedin.com/jobs/view/333333333/",
                "query_ids": ["T1"],
                "first_level_decision": "FORWARD",
                "reason_codes": [],
            },
        ],
        "detail_requested_job_ids": ["111111111", "222222222"],
        "details": [
            {
                "job_id": "111111111",
                "title": "Business Analyst",
                "company": "Example GmbH",
                "location": "Berlin, Germany",
                "retrieval_status": "retrieval_failed",
                "description": "Partially captured responsibilities",
                "extraction_warnings": ["ABOUT_SECTION_NOT_VISIBLE"],
                "query_ids": ["T1"],
            }
        ],
        "filter_verification": {
            "T1": {
                "status": "verified_visible_controls",
                "requested": portfolio["queries"][0]["filters"],
                "observed": {
                    "date_posted_visible": True,
                    "sort_by_visible": True,
                },
                "ui_fallback_used": False,
                "warnings": [],
            }
        },
        "warnings": [],
    }
    portfolio_path = root / "portfolio.json"
    policy_path = root / "policy.json"
    checkpoint_path = run_dir / "browser-checkpoint.json"
    write_json(portfolio_path, portfolio)
    write_json(policy_path, {"schema_version": "1.0"})
    write_json(checkpoint_path, checkpoint)

    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(checkpoint_path),
            "--portfolio",
            str(portfolio_path),
            "--policy",
            str(policy_path),
            "--cache-run",
            str(cache_dir),
        ],
        check=True,
    )

    manifest_path = run_dir / "run-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["schema_version"] == "1.1"
    assert manifest["metrics"]["retrieval_failed"] == 2
    assert next(job for job in manifest["jobs"] if job["job_id"] == "333333333")["collection_status"] == "not_requested"
    assert manifest["filter_verification"] == checkpoint["filter_verification"]
    assert manifest["failed_jobs_review"] == {
        "json": "failed-jobs.json",
        "markdown": "failed-jobs.md",
        "count": 2,
    }
    failed_manifest_jobs = [
        job for job in manifest["jobs"] if job["collection_status"] == "retrieval_failed"
    ]
    assert all(job["manual_review_required"] for job in failed_manifest_jobs)
    assert all(job["review_url"].startswith("https://www.linkedin.com/jobs/view/") for job in failed_manifest_jobs)

    review = json.loads((run_dir / "failed-jobs.json").read_text(encoding="utf-8"))
    assert review["jobs"][0]["partial_description"] == "Partially captured responsibilities"
    assert review["jobs"][0]["retrieval_warnings"] == ["ABOUT_SECTION_NOT_VISIBLE"]
    assert review["jobs"][1]["retrieval_warnings"] == [
        "DETAIL_NOT_RETRIEVED_AND_CACHE_MISS"
    ]
    review_markdown = (run_dir / "failed-jobs.md").read_text(encoding="utf-8")
    assert "[Open LinkedIn job](https://www.linkedin.com/jobs/view/111111111/)" in review_markdown
    assert "[Open LinkedIn job](https://www.linkedin.com/jobs/view/222222222/)" in review_markdown
    assert "Partially captured responsibilities" in review_markdown
    assert validate_manifest(manifest_path) == {
        "run_id": "failed-review-test",
        "jobs": 3,
        "valid": True,
    }

print("materialize_browser_checkpoint tests passed")
