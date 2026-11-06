#!/usr/bin/env python3

import json
from copy import deepcopy
import tempfile
from pathlib import Path

from materialize_screening_batch import materialize, validate_german_jd_gate


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
    jobs_dir = root / "jobs"
    jobs_dir.mkdir()
    english_description = (
        "We are looking for an analyst to join our international finance team. "
        "You will analyze processes, prepare reports, work with stakeholders, and support projects. "
        "The candidate should have a degree, relevant experience, analytical skills, and strong communication. "
    ) * 3
    for job_id in ("123", "456"):
        (jobs_dir / f"{job_id}.json").write_text(
            json.dumps({"description": english_description}), encoding="utf-8"
        )
    result = materialize(paths["candidate"], paths["manifest"], paths["assessments"], root / "output")
    assert result["gate_counts"]["FAIL"] == 1
    assert result["gate_counts"]["PASS"] == 1
    assert result["application_generation"] is True
    assert result["application_candidates"] == ["456"]
    assert result["candidate_profile_fingerprint"].startswith("sha256:")
    assert result["jobs"][0]["next_action"] == "STOP"
    assert result["jobs"][1]["next_action"] == "GENERATE_CV"
    assert (root / "output" / "123" / "screening-report.json").is_file()

    policy_screening = json.loads(json.dumps(passing))
    policy_screening["requirements"][0].update({
        "hardness_basis": "candidate_policy",
        "policy_evidence": {"policy_confirmation_id": "locations", "ledger_confirmation_id": "preference-locations", "screening_gate_id": "location-gate"},
    })
    policy = {
        "candidate_id": "candidate-b",
        "confirmation_items": [{"id": "locations", "status": "resolved", "answer": ["Berlin"]}],
        "screening_gates": [{"id": "location-gate", "criterion": "Acceptable location", "confirmation_id": "locations", "ledger_confirmation_id": "preference-locations", "status": "active"}],
    }
    confirmations = {
        "candidate_id": "candidate-b",
        "as_of": "2026-07-25",
        "confirmations": [{
            "id": "preference-locations", "kind": "preference", "status": "active",
            "answer": ["Berlin"],
            "scope": {"profile_fact_ids": [], "policy_confirmation_ids": ["locations"], "screening_gate_ids": ["location-gate"]},
        }],
    }
    from validate_case import artifact_fingerprint
    policy["confirmation_ledger"] = {"fingerprint": artifact_fingerprint(confirmations)}
    from validate_case import validate
    assert validate(candidate, policy_screening, policy, confirmations) == []
    assert any("requires policy and confirmation ledger" in error for error in validate(candidate, policy_screening))

    german_detection = {
        "is_german": True,
        "detector_version": "german-jd-v1",
    }
    try:
        validate_german_jd_gate(manifest["jobs"][0], screening, german_detection)
        raise AssertionError("German JD should reject a generic FAIL without language evidence")
    except ValueError as error:
        assert "JD_LANGUAGE_GERMAN" in str(error)

    german_screening = json.loads(json.dumps(screening))
    german_screening["reason_codes"] = ["JD_LANGUAGE_GERMAN"]
    german_screening["jd_language_detection"] = {"detector_version": "german-jd-v1"}
    german_screening["requirements"] = [{
        "id": "JD-LANGUAGE-DE", "criterion": "JD language is German", "classification": "hard",
        "hardness_basis": "user_override", "candidate_status": "unmet",
        "jd_evidence": "Deterministic full-body language precheck", "candidate_evidence": [],
        "confidence": "high", "reasoning": "Configured user rule", "follow_up_question": None,
    }]
    validate_german_jd_gate(manifest["jobs"][0], german_screening, german_detection)

    overridden = deepcopy(german_screening)
    overridden.update({
        "gate": "OVERRIDDEN", "recommendation": "ADVANCE",
        "override": {
            "job_id": "123", "requirement_ids": ["JD-LANGUAGE-DE"],
            "user_answer": "Ignore the German JD rule for this job only.",
            "user_message_locator": "test-conversation/message-1",
        },
    })
    validate_german_jd_gate(manifest["jobs"][0], overridden, german_detection)
    for invalid in (True, {**overridden["override"], "job_id": "456"},
                    {**overridden["override"], "user_message_locator": ""},
                    {**overridden["override"], "requirement_ids": []}):
        bad = {**overridden, "override": invalid}
        try:
            validate_german_jd_gate(manifest["jobs"][0], bad, german_detection)
            raise AssertionError("An unscoped or unproven override must be rejected")
        except ValueError:
            pass

    unwaived = deepcopy(overridden)
    unwaived["requirements"].append(deepcopy(screening["requirements"][0]))
    try:
        validate_german_jd_gate(manifest["jobs"][0], unwaived, german_detection)
        raise AssertionError("A language waiver must not waive another hard blocker")
    except ValueError as error:
        assert "unwaived hard requirements" in str(error)

    # Exercise the complete materialization path, not just the gate helper.
    from detect_jd_language import analyze_jd_language
    german_body = (
        "Wir suchen einen Analysten für unser Team. Deine Aufgaben umfassen die Analyse von "
        "Geschäftsprozessen und die Zusammenarbeit mit verschiedenen Fachbereichen. Du verfügst "
        "über ein abgeschlossenes Studium und erste Erfahrung im Finanzbereich. Sehr gute "
        "Kenntnisse in Excel sowie sichere Kommunikation sind für diese Position wichtig. "
        "Wir bieten dir Verantwortung, Weiterbildung und flexible Arbeitszeiten. "
    ) * 3
    actual_detection = analyze_jd_language(german_body)
    assert actual_detection["is_german"]
    (jobs_dir / "123.json").write_text(json.dumps({"description": german_body}), encoding="utf-8")
    overridden["jd_language_detection"] = actual_detection
    revised_assessments = deepcopy(assessments)
    revised_assessments["assessments"][0]["screening"] = overridden
    paths["assessments"].write_text(json.dumps(revised_assessments), encoding="utf-8")
    resumed = materialize(paths["candidate"], paths["manifest"], paths["assessments"], root / "overridden-output")
    assert resumed["application_candidates"] == ["123", "456"]
    assert resumed["jobs"][0]["gate"] == "OVERRIDDEN"
    saved = json.loads((root / "overridden-output/123/screening-report.json").read_text(encoding="utf-8"))
    assert saved["underlying_gate"] == "FAIL"
    assert saved["reason_codes"] == ["JD_LANGUAGE_GERMAN"]

print("materialize_screening_batch tests passed")
