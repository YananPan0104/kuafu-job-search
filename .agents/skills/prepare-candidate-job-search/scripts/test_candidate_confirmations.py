#!/usr/bin/env python3

from candidate_confirmations import fingerprint, link_policy, migrated_ledger, validate_ledger


PROFILE = {
    "schema_version": "1.0",
    "candidate_id": "candidate-test",
    "as_of": "2026-07-28",
    "facts": [
        {"id": "language.de", "category": "language", "value": "B1", "status": "verified", "sources": ["candidate confirmation 2026-07-28"]},
        {"id": "skill.sql", "category": "skills", "value": "SQL", "status": "source_claimed", "sources": ["cv.pdf#page=1"]},
    ],
    "conflicts": [],
    "unverified_claims": [],
}
POLICY = {
    "candidate_id": "candidate-test",
    "as_of": "2026-07-28",
    "policy_version": "1",
    "confirmation_items": [
        {"id": "locations", "question": "Where?", "required": True, "status": "resolved", "answer": ["Berlin", "Remote"]},
        {"id": "travel", "question": "Travel?", "required": False, "status": "open", "answer": None},
    ],
}

ledger = migrated_ledger(PROFILE, POLICY, "2026-07-28")
assert len(ledger["confirmations"]) == 2
assert {item["kind"] for item in ledger["confirmations"]} == {"fact", "preference"}
assert validate_ledger(ledger, PROFILE, POLICY)["active"] == 2
linked = link_policy(POLICY, ledger)
assert linked["confirmation_items"][0]["ledger_confirmation_id"] == "preference-locations"
assert "ledger_confirmation_id" not in linked["confirmation_items"][1]
assert linked["confirmation_ledger"]["fingerprint"] == fingerprint(ledger)

print("candidate confirmation tests passed")
