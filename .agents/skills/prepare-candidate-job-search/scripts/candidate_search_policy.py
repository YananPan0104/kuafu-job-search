#!/usr/bin/env python3
"""Create and validate evidence-linked candidate job-search policy drafts."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date
from pathlib import Path

from candidate_confirmations import fingerprint as confirmation_fingerprint
from candidate_confirmations import validate_ledger


PROFILE_KEYS = {"schema_version", "candidate_id", "as_of", "facts", "conflicts", "unverified_claims"}
FACT_STATUSES = {"verified", "source_claimed", "needs_confirmation", "expired"}
POLICY_STATUSES = {"draft", "confirmed"}
TARGET_STATUSES = {"proposed", "approved", "retired"}


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def require_keys(value: dict, keys: set[str], label: str) -> None:
    missing = sorted(keys - value.keys())
    if missing:
        raise ValueError(f"{label} is missing: {', '.join(missing)}")


def profile_fingerprint(profile: dict) -> str:
    payload = json.dumps(
        profile, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def validate_profile(profile: dict) -> dict[str, dict]:
    require_keys(profile, PROFILE_KEYS, "candidate profile")
    if not isinstance(profile["facts"], list):
        raise ValueError("candidate profile facts must be an array")
    if not isinstance(profile["conflicts"], list) or not isinstance(profile["unverified_claims"], list):
        raise ValueError("candidate profile conflicts and unverified_claims must be arrays")
    facts: dict[str, dict] = {}
    for index, fact in enumerate(profile["facts"]):
        require_keys(fact, {"id", "category", "value", "status", "sources"}, f"facts[{index}]")
        if fact["id"] in facts:
            raise ValueError(f"duplicate candidate fact id: {fact['id']}")
        if fact["status"] not in FACT_STATUSES:
            raise ValueError(f"facts[{index}] has invalid status")
        facts[fact["id"]] = fact
    return facts


def fact_refs(profile: dict, categories: set[str]) -> list[dict]:
    return [
        {"fact_id": fact["id"], "status": fact["status"]}
        for fact in profile["facts"]
        if fact["category"] in categories and fact["status"] != "expired"
    ]


def build_draft(profile: dict, as_of: str | None = None) -> dict:
    facts = validate_profile(profile)
    policy_date = as_of or date.today().isoformat()
    candidate_id = str(profile["candidate_id"]).strip()
    if not candidate_id:
        raise ValueError("candidate_id must be non-empty")
    return {
        "schema_version": "1.0",
        "policy_version": f"draft-{policy_date}",
        "candidate_id": candidate_id,
        "as_of": policy_date,
        "status": "draft",
        "source_profile": {
            "candidate_id": candidate_id,
            "as_of": profile["as_of"],
            "fingerprint": profile_fingerprint(profile),
            "fact_ids": sorted(facts),
        },
        "candidate_signals": {
            "languages": fact_refs(profile, {"language"}),
            "locations": fact_refs(profile, {"location"}),
            "work_authorization": fact_refs(profile, {"work_authorization"}),
            "skills": fact_refs(profile, {"skills", "knowledge", "system_exposure"}),
            "experience": fact_refs(profile, {"experience"}),
            "education": fact_refs(profile, {"education"}),
            "certifications": fact_refs(profile, {"certification"}),
        },
        "proposed_preferences": {
            "locations": [],
            "employment_types": [],
            "experience_levels": [],
            "date_posted": None,
            "sort_by": None,
            "title_language_policy": {
                "de": {"enabled": False, "mode": "off", "action": "collect"},
                "unknown": "collect",
            },
        },
        "default_filters": {
            "location": None,
            "date_posted": None,
            "employment_type": [],
            "experience_level": [],
            "sort_by": None,
        },
        "metadata_triage": {
            "skip_by_title_signals": [],
            "review_if_time_signals": [],
        },
        "screening_gates": [],
        "search_targets": [],
        "confirmation_items": [
            {"id": "search-locations", "question": "Which locations and remote arrangements are acceptable?", "required": True, "status": "open", "answer": None},
            {"id": "employment-types", "question": "Which employment types are acceptable?", "required": True, "status": "open", "answer": None},
            {"id": "experience-levels", "question": "Which LinkedIn experience levels should be searched?", "required": True, "status": "open", "answer": None},
            {"id": "title-language", "question": "Should titles in any language be skipped before JD extraction?", "required": True, "status": "open", "answer": None},
            {"id": "role-targets", "question": "Which proposed role families should be included in the first query portfolio?", "required": True, "status": "open", "answer": None},
        ],
    }


def validate_policy(profile: dict, policy: dict, confirmations: dict | None = None) -> dict:
    facts = validate_profile(profile)
    require_keys(
        policy,
        {"schema_version", "policy_version", "candidate_id", "as_of", "status", "source_profile", "candidate_signals", "proposed_preferences", "default_filters", "metadata_triage", "search_targets", "confirmation_items"},
        "job-search policy",
    )
    ids = {str(profile["candidate_id"]), str(policy["candidate_id"]), str(policy["source_profile"].get("candidate_id"))}
    if len(ids) != 1:
        raise ValueError(f"candidate_id mismatch between profile and policy: {sorted(ids)}")
    expected_fingerprint = policy["source_profile"].get("fingerprint")
    if expected_fingerprint and expected_fingerprint != profile_fingerprint(profile):
        raise ValueError("policy source_profile fingerprint does not match candidate profile")
    if policy["status"] not in POLICY_STATUSES:
        raise ValueError("policy status must be draft or confirmed")
    if not isinstance(policy["confirmation_items"], list) or not isinstance(policy["search_targets"], list):
        raise ValueError("confirmation_items and search_targets must be arrays")

    confirmation_ids: set[str] = set()
    open_required = []
    resolved_ids = set()
    ledger_ids = {
        str(item["id"]): item
        for item in (confirmations or {}).get("confirmations", [])
        if item.get("status") == "active"
    }
    for index, item in enumerate(policy["confirmation_items"]):
        require_keys(item, {"id", "question", "required", "status", "answer"}, f"confirmation_items[{index}]")
        if item["id"] in confirmation_ids:
            raise ValueError(f"duplicate confirmation id: {item['id']}")
        confirmation_ids.add(item["id"])
        if item["status"] not in {"open", "resolved"}:
            raise ValueError(f"confirmation_items[{index}] has invalid status")
        if item["status"] == "resolved":
            resolved_ids.add(item["id"])
            ledger_id = item.get("ledger_confirmation_id")
            if confirmations is not None:
                if not ledger_id or ledger_id not in ledger_ids:
                    raise ValueError(f"confirmation_items[{index}] is resolved but lacks an active ledger confirmation")
                ledger_item = ledger_ids[ledger_id]
                if item["id"] not in ledger_item["scope"]["policy_confirmation_ids"]:
                    raise ValueError(f"confirmation_items[{index}] ledger scope does not reference the policy item")
                if ledger_item["answer"] != item["answer"]:
                    raise ValueError(f"confirmation_items[{index}] answer differs from the confirmation ledger")
        if item["required"] and item["status"] == "open":
            open_required.append(item["id"])

    target_ids = set()
    active_targets = 0
    for index, target in enumerate(policy["search_targets"]):
        require_keys(target, {"target_id", "purpose", "must_groups", "exclude_terms", "rationale", "known_noise", "evidence_fact_ids", "confirmation_ids", "status"}, f"search_targets[{index}]")
        if target["target_id"] in target_ids:
            raise ValueError(f"duplicate search target id: {target['target_id']}")
        target_ids.add(target["target_id"])
        if target["status"] not in TARGET_STATUSES:
            raise ValueError(f"search_targets[{index}] has invalid status")
        if target["status"] != "retired":
            active_targets += 1
        if not isinstance(target["must_groups"], list) or not target["must_groups"]:
            raise ValueError(f"search_targets[{index}] must contain must_groups")
        for group in target["must_groups"]:
            require_keys(group, {"label", "terms"}, f"search_targets[{index}].must_groups")
            if not isinstance(group["terms"], list) or not any(str(term).strip() for term in group["terms"]):
                raise ValueError(f"search_targets[{index}] contains an empty term group")
        unknown_facts = sorted(set(target["evidence_fact_ids"]) - facts.keys())
        if unknown_facts:
            raise ValueError(f"search_targets[{index}] references unknown facts: {unknown_facts}")
        unknown_confirmations = sorted(set(target["confirmation_ids"]) - confirmation_ids)
        if unknown_confirmations:
            raise ValueError(f"search_targets[{index}] references unknown confirmations: {unknown_confirmations}")
        if not target["evidence_fact_ids"] and not set(target["confirmation_ids"]) & resolved_ids:
            raise ValueError(f"search_targets[{index}] requires evidence or a resolved confirmation")

    if policy["status"] == "confirmed":
        if open_required:
            raise ValueError(f"confirmed policy has open required confirmations: {open_required}")
        if active_targets == 0:
            raise ValueError("confirmed policy requires at least one non-retired search target")

    screening_gate_ids = set()
    for index, gate in enumerate(policy.get("screening_gates", [])):
        require_keys(gate, {"id", "criterion", "confirmation_id", "ledger_confirmation_id", "status"}, f"screening_gates[{index}]")
        gate_id = str(gate["id"])
        if not gate_id or gate_id in screening_gate_ids:
            raise ValueError(f"screening_gates[{index}] has an empty or duplicate id")
        screening_gate_ids.add(gate_id)
        if gate["status"] not in {"active", "retired"}:
            raise ValueError(f"screening_gates[{index}] has invalid status")
        policy_confirmation = next((item for item in policy["confirmation_items"] if item["id"] == gate["confirmation_id"]), None)
        if gate["status"] == "active" and (not policy_confirmation or policy_confirmation["status"] != "resolved"):
            raise ValueError(f"screening_gates[{index}] requires a resolved policy confirmation")
        if confirmations is not None and gate["status"] == "active":
            ledger_item = ledger_ids.get(str(gate["ledger_confirmation_id"]))
            if not ledger_item or gate_id not in ledger_item["scope"]["screening_gate_ids"]:
                raise ValueError(f"screening_gates[{index}] lacks an active scoped ledger confirmation")

    ledger_ref = policy.get("confirmation_ledger")
    if ledger_ref:
        if confirmations is None:
            raise ValueError("policy references a confirmation ledger but none was supplied")
        validate_ledger(confirmations, profile, policy)
        if str(ledger_ref.get("candidate_id")) != str(profile["candidate_id"]):
            raise ValueError("policy confirmation_ledger candidate_id does not match candidate profile")
        if ledger_ref.get("fingerprint") != confirmation_fingerprint(confirmations):
            raise ValueError("policy confirmation_ledger fingerprint does not match confirmation ledger")

    return {
        "candidate_id": profile["candidate_id"],
        "policy_status": policy["status"],
        "search_targets": len(policy["search_targets"]),
        "open_required_confirmations": len(open_required),
        "valid": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    draft = sub.add_parser("draft")
    draft.add_argument("--profile", type=Path, required=True)
    draft.add_argument("--output", type=Path, required=True)
    draft.add_argument("--as-of")
    validate = sub.add_parser("validate")
    validate.add_argument("--profile", type=Path, required=True)
    validate.add_argument("--policy", type=Path, required=True)
    validate.add_argument("--confirmations", type=Path)
    validate_profile_command = sub.add_parser("validate-profile")
    validate_profile_command.add_argument("--profile", type=Path, required=True)
    args = parser.parse_args()

    profile = load_json(args.profile)
    if args.command == "validate-profile":
        facts = validate_profile(profile)
        print(json.dumps({"candidate_id": profile["candidate_id"], "facts": len(facts), "fingerprint": profile_fingerprint(profile), "valid": True}, ensure_ascii=False))
    elif args.command == "draft":
        output = build_draft(profile, args.as_of)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"candidate_id": output["candidate_id"], "status": "draft", "output": str(args.output)}, ensure_ascii=False))
    else:
        policy = load_json(args.policy)
        confirmations = load_json(args.confirmations) if args.confirmations else None
        print(json.dumps(validate_policy(profile, policy, confirmations), ensure_ascii=False))


if __name__ == "__main__":
    main()
