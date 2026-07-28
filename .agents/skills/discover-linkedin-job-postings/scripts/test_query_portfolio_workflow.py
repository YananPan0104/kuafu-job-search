#!/usr/bin/env python3

import copy

from generate_query_portfolio import generate_portfolio, profile_fingerprint
from validate_discovery_inputs import artifact_fingerprint, validate_inputs


PROFILE = {
    "candidate_id": "candidate-b",
    "as_of": "2026-07-25",
    "facts": [{"id": "skills.analytics"}],
}

POLICY = {
    "candidate_id": "candidate-b",
    "policy_version": "2026-07-25.1",
    "as_of": "2026-07-25",
    "status": "draft",
    "source_profile": {"candidate_id": "candidate-b", "as_of": "2026-07-25"},
    "default_filters": {
        "location": "Netherlands",
        "date_posted": "Past week",
        "employment_type": ["Full-time"],
        "experience_level": ["Entry level"],
        "sort_by": "Most recent",
    },
    "default_run_profile": "daily",
    "run_profiles": {
        "daily": {"filter_overrides": {"date_posted": "Past 24 hours", "sort_by": "Most recent"}, "collection_limit": 100},
        "capability_test": {"filter_overrides": {"date_posted": "Past week", "sort_by": "Most relevant"}, "collection_limit": 20},
    },
    "confirmation_items": [{"id": "role-targets", "required": True, "status": "open"}],
    "search_targets": [{
        "target_id": "analytics",
        "purpose": "Analytics roles",
        "must_groups": [
            {"label": "role", "terms": ["data analyst", "business analyst"]},
            {"label": "skill", "terms": ["SQL", "Tableau"]},
        ],
        "exclude_terms": ["intern", "software engineer"],
        "rationale": "Verified analytics skills",
        "known_noise": ["engineering"],
        "evidence_fact_ids": ["skills.analytics"],
        "confirmation_ids": ["role-targets"],
        "status": "proposed",
    }],
}


portfolio = generate_portfolio(PROFILE, POLICY)
assert portfolio["candidate_id"] == "candidate-b"
assert portfolio["queries"][0]["status"] == "draft"
assert portfolio["source_profile_fingerprint"] == profile_fingerprint(PROFILE)
assert portfolio["queries"][0]["statement"] == '("data analyst" OR "business analyst") AND (SQL OR Tableau) NOT (intern OR "software engineer")'
assert portfolio["run_profile"] == "daily"
assert portfolio["collection_limit"] == 100
assert portfolio["queries"][0]["filters"]["date_posted"] == "Past 24 hours"
assert validate_inputs(PROFILE, POLICY, portfolio)["active_queries"] == 0

test_portfolio = generate_portfolio(PROFILE, POLICY, "capability_test")
assert test_portfolio["collection_limit"] == 20
assert test_portfolio["queries"][0]["filters"]["date_posted"] == "Past week"

active = copy.deepcopy(portfolio)
active["queries"][0]["status"] = "active"
try:
    validate_inputs(PROFILE, POLICY, active)
    raise AssertionError("draft policy must block active queries")
except ValueError as error:
    assert "confirmed" in str(error)

confirmed_policy = copy.deepcopy(POLICY)
confirmed_policy["status"] = "confirmed"
confirmed_policy["confirmation_items"][0]["status"] = "resolved"
confirmed_policy["confirmation_items"][0]["answer"] = "approved"
confirmed_policy["search_targets"][0]["status"] = "approved"
confirmed_portfolio = generate_portfolio(PROFILE, confirmed_policy)
assert confirmed_portfolio["queries"][0]["status"] == "active"
assert validate_inputs(PROFILE, confirmed_policy, confirmed_portfolio)["active_queries"] == 1

ledger = {
    "candidate_id": "candidate-b",
    "confirmations": [{
        "id": "preference-role-targets", "status": "active", "answer": "approved",
        "scope": {"policy_confirmation_ids": ["role-targets"]},
    }],
}
ledger_policy = copy.deepcopy(confirmed_policy)
ledger_policy["confirmation_items"][0]["ledger_confirmation_id"] = "preference-role-targets"
ledger_policy["confirmation_ledger"] = {"fingerprint": artifact_fingerprint(ledger)}
assert validate_inputs(PROFILE, ledger_policy, confirmed_portfolio, ledger)["active_queries"] == 1
try:
    validate_inputs(PROFILE, ledger_policy, confirmed_portfolio)
    raise AssertionError("referenced confirmation ledger must be supplied")
except ValueError as error:
    assert "none was supplied" in str(error)

mismatch = copy.deepcopy(portfolio)
mismatch["candidate_id"] = "candidate-a"
try:
    validate_inputs(PROFILE, POLICY, mismatch)
    raise AssertionError("candidate mismatch should fail")
except ValueError as error:
    assert "candidate_id mismatch" in str(error)

fingerprint_mismatch = copy.deepcopy(portfolio)
fingerprint_mismatch["source_profile_fingerprint"] = "sha256:wrong"
try:
    validate_inputs(PROFILE, POLICY, fingerprint_mismatch)
    raise AssertionError("profile fingerprint mismatch should fail")
except ValueError as error:
    assert "fingerprint" in str(error)

print("query portfolio workflow tests passed")
