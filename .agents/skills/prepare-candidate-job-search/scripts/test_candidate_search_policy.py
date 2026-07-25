#!/usr/bin/env python3

import copy
from candidate_search_policy import build_draft, profile_fingerprint, validate_policy, validate_profile


PROFILE = {
    "schema_version": "1.0",
    "candidate_id": "candidate-b",
    "as_of": "2026-07-25",
    "facts": [
        {"id": "language.english", "category": "language", "value": "C1", "status": "verified", "sources": ["cv"]},
        {"id": "skills.analytics", "category": "skills", "value": ["SQL", "Tableau"], "status": "verified", "sources": ["cv"]},
    ],
    "conflicts": [],
    "unverified_claims": [],
}


draft = build_draft(PROFILE, "2026-07-25")
assert draft["candidate_id"] == "candidate-b"
assert draft["status"] == "draft"
assert draft["candidate_signals"]["skills"][0]["fact_id"] == "skills.analytics"
assert draft["source_profile"]["fingerprint"] == profile_fingerprint(PROFILE)
assert len(validate_profile(PROFILE)) == 2
assert validate_policy(PROFILE, draft)["open_required_confirmations"] == 5

confirmed = copy.deepcopy(draft)
confirmed["status"] = "confirmed"
for item in confirmed["confirmation_items"]:
    item["status"] = "resolved"
    item["answer"] = "confirmed for test"
confirmed["search_targets"] = [{
    "target_id": "analytics",
    "purpose": "Analytics roles",
    "must_groups": [{"label": "role", "terms": ["data analyst"]}, {"label": "skill", "terms": ["SQL", "Tableau"]}],
    "exclude_terms": ["intern"],
    "rationale": "Uses verified analytics skills",
    "known_noise": ["engineering roles"],
    "evidence_fact_ids": ["skills.analytics"],
    "confirmation_ids": ["role-targets"],
    "status": "approved",
}]
assert validate_policy(PROFILE, confirmed)["policy_status"] == "confirmed"

mismatch = copy.deepcopy(confirmed)
mismatch["candidate_id"] = "candidate-a"
try:
    validate_policy(PROFILE, mismatch)
    raise AssertionError("candidate mismatch should fail")
except ValueError as error:
    assert "candidate_id mismatch" in str(error)

changed_profile = copy.deepcopy(PROFILE)
changed_profile["facts"][0]["value"] = "B2"
try:
    validate_policy(changed_profile, confirmed)
    raise AssertionError("profile fingerprint mismatch should fail")
except ValueError as error:
    assert "fingerprint" in str(error)

print("candidate_search_policy tests passed")
