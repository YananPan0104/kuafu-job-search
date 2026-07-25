#!/usr/bin/env python3

import json
import tempfile
from pathlib import Path

from validate_discovery_run import validate_manifest


with tempfile.TemporaryDirectory() as temp_dir:
    run_dir = Path(temp_dir)
    jobs_dir = run_dir / "jobs"
    jobs_dir.mkdir()

    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Business Analyst",
        "hiringOrganization": {"@type": "Organization", "name": "Example GmbH"},
        "description": "Visible job description",
        "url": "https://www.linkedin.com/jobs/view/123456789/",
    }
    (jobs_dir / "123456789.json").write_text(json.dumps(posting), encoding="utf-8")
    (jobs_dir / "123456789.md").write_text("# Business Analyst\n", encoding="utf-8")

    manifest = {
        "schema_version": "1.0",
        "run_id": "contract-test",
        "candidate_id": "test-candidate",
        "source": "linkedin",
        "trigger": {"type": "manual", "id": "contract-test"},
        "started_at": "2026-07-25T20:00:00+02:00",
        "query_portfolio_path": "../../query-portfolio.json",
        "policy_path": "../../job-search-policy.json",
        "filter_verification": {"Q1": {"status": "verified"}},
        "jobs": [
            {
                "job_id": "123456789",
                "title": "Business Analyst",
                "company": "Example GmbH",
                "canonical_url": "https://www.linkedin.com/jobs/view/123456789/",
                "query_ids": ["Q1"],
                "first_level_decision": "FORWARD",
                "reason_codes": [],
                "collection_status": "retrieved",
                "jobposting_json": "jobs/123456789.json",
                "jobposting_markdown": "jobs/123456789.md",
            }
        ],
        "metrics": {
            "cards_discovered": 1,
            "details_skipped": 0,
            "details_retrieved": 1,
            "cache_hits": 0,
            "retrieval_failed": 0,
        },
        "warnings": [],
    }
    manifest_path = run_dir / "run-manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    result = validate_manifest(manifest_path)
    assert result == {"run_id": "contract-test", "jobs": 1, "valid": True}

print("validate_discovery_run tests passed")
