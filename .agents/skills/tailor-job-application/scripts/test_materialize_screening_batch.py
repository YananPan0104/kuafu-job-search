#!/usr/bin/env python3

import json
import tempfile
from pathlib import Path

from materialize_screening_batch import materialize


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    candidate = {
        "schema_version": "1.0", "candidate_id": "candidate-b", "as_of": "2026-07-25",
        "facts": [], "conflicts": [], "unverified_claims": [],
    }
    manifest = {
        "run_id": "run-1",
        "jobs": [{
            "job_id": "123", "title": "Analyst", "company": "Example", "canonical_url": "https://example.test/123",
            "query_ids": ["Q1"], "collection_status": "retrieved", "jobposting_json": "jobs/123.json",
        }, {
            "job_id": "456", "title": "Finance Analyst", "company": "Example", "canonical_url": "https://example.test/456",
            "query_ids": ["Q2"], "collection_status": "cached", "jobposting_json": "jobs/456.json",
        }],
    }
    screening = {
        "schema_version": "1.0", "case_id": "screening-123", "gate": "FAIL", "underlying_gate": "FAIL",
        "recommendation": "DO_NOT_ADVANCE", "requirements": [{
            "id": "R1", "criterion": "Mandatory licence", "classification": "hard", "hardness_basis": "explicit",
            "candidate_status": "unmet", "jd_evidence": "Licence required", "candidate_evidence": [],
            "confidence": "high", "reasoning": "No evidence", "follow_up_question": None,
        }], "blocking_questions": [], "override": None,
    }
    passing = json.loads(json.dumps(screening))
    passing.update({"case_id": "screening-456", "gate": "PASS", "underlying_gate": "PASS", "recommendation": "ADVANCE"})
    passing["requirements"][0].update({"candidate_status": "met", "candidate_evidence": ["fact.licence"], "reasoning": "Verified"})
    assessments = {"batch_id": "batch-1", "candidate_id": "candidate-b", "source_run_id": "run-1", "assessments": [{"job_id": "123", "screening": screening}, {"job_id": "456", "screening": passing}]}
    paths = {}
    for name, value in (("candidate", candidate), ("manifest", manifest), ("assessments", assessments)):
        paths[name] = root / f"{name}.json"
        paths[name].write_text(json.dumps(value), encoding="utf-8")
    result = materialize(paths["candidate"], paths["manifest"], paths["assessments"], root / "output")
    assert result["gate_counts"]["FAIL"] == 1
    assert result["gate_counts"]["PASS"] == 1
    assert result["application_generation"] is True
    assert result["application_candidates"] == ["456"]
    assert result["candidate_profile_fingerprint"].startswith("sha256:")
    assert result["jobs"][0]["next_action"] == "STOP"
    assert result["jobs"][1]["next_action"] == "GENERATE_CV"
    assert (root / "output" / "123" / "screening-report.json").is_file()

print("materialize_screening_batch tests passed")
