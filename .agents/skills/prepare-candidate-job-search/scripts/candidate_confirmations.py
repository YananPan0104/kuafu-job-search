#!/usr/bin/env python3
"""Create, migrate, and validate candidate confirmation ledgers."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date
from pathlib import Path


KINDS = {"fact", "preference", "screening_gate", "override"}
STATUSES = {"active", "superseded", "revoked"}
CONFIRMATION_SOURCE = re.compile(r"confirm|candidate.?statement|user.?statement|conversation|interview", re.IGNORECASE)


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fingerprint(value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def stable_id(prefix: str, source_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", source_id.lower()).strip("-")
    return f"{prefix}-{slug}"


def answer_type(value: object) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"
    return "string"


def source_texts(fact: dict) -> list[str]:
    values = []
    for source in fact.get("sources", []):
        if isinstance(source, str):
            values.append(source)
        elif isinstance(source, dict):
            values.append(json.dumps(source, ensure_ascii=False, sort_keys=True))
    return values


def migrated_ledger(profile: dict, policy: dict | None, as_of: str | None = None) -> dict:
    candidate_id = str(profile.get("candidate_id", "")).strip()
    if not candidate_id:
        raise ValueError("candidate profile requires a non-empty candidate_id")
    if policy and str(policy.get("candidate_id")) != candidate_id:
        raise ValueError("candidate_id mismatch between profile and policy")
    ledger_date = as_of or date.today().isoformat()
    confirmations = []

    for fact in profile.get("facts", []):
        matched_sources = [source for source in source_texts(fact) if CONFIRMATION_SOURCE.search(source)]
        if not matched_sources:
            continue
        fact_id = str(fact["id"])
        confirmations.append({
            "id": stable_id("fact", fact_id),
            "kind": "fact",
            "status": "active",
            "question": None,
            "answer": fact.get("value"),
            "answer_type": answer_type(fact.get("value")),
            "recorded_at": profile.get("as_of", ledger_date),
            "source": {
                "type": "migrated_candidate_statement",
                "artifact": "candidate-profile.json",
                "locator": f"facts[id={fact_id}].sources",
                "original_references": matched_sources,
            },
            "scope": {
                "profile_fact_ids": [fact_id],
                "policy_confirmation_ids": [],
                "screening_gate_ids": [],
            },
        })

    if policy:
        for item in policy.get("confirmation_items", []):
            if item.get("status") != "resolved":
                continue
            item_id = str(item["id"])
            confirmations.append({
                "id": stable_id("preference", item_id),
                "kind": "preference",
                "status": "active",
                "question": item.get("question"),
                "answer": item.get("answer"),
                "answer_type": answer_type(item.get("answer")),
                "recorded_at": policy.get("as_of", ledger_date),
                "source": {
                    "type": "migrated_policy_confirmation",
                    "artifact": "job-search-policy.json",
                    "locator": f"confirmation_items[id={item_id}]",
                },
                "scope": {
                    "profile_fact_ids": [],
                    "policy_confirmation_ids": [item_id],
                    "screening_gate_ids": [],
                },
            })

    return {
        "schema_version": "1.0",
        "candidate_id": candidate_id,
        "as_of": ledger_date,
        "confirmations": confirmations,
        "migration": {
            "profile_as_of": profile.get("as_of"),
            "policy_version": policy.get("policy_version") if policy else None,
            "rule": "explicit_confirmation_references_and_resolved_policy_items_only",
        },
    }


def validate_ledger(ledger: dict, profile: dict | None = None, policy: dict | None = None) -> dict:
    required = {"schema_version", "candidate_id", "as_of", "confirmations"}
    missing = sorted(required - ledger.keys())
    if missing:
        raise ValueError(f"confirmation ledger is missing: {', '.join(missing)}")
    if not isinstance(ledger["confirmations"], list):
        raise ValueError("confirmation ledger confirmations must be an array")
    if profile and str(profile.get("candidate_id")) != str(ledger["candidate_id"]):
        raise ValueError("candidate_id mismatch between profile and confirmation ledger")
    if policy and str(policy.get("candidate_id")) != str(ledger["candidate_id"]):
        raise ValueError("candidate_id mismatch between policy and confirmation ledger")

    fact_ids = {str(fact.get("id")) for fact in (profile or {}).get("facts", [])}
    policy_ids = {str(item.get("id")) for item in (policy or {}).get("confirmation_items", [])}
    ids = set()
    active = 0
    for index, item in enumerate(ledger["confirmations"]):
        item_required = {"id", "kind", "status", "question", "answer", "answer_type", "recorded_at", "source", "scope"}
        item_missing = sorted(item_required - item.keys())
        if item_missing:
            raise ValueError(f"confirmations[{index}] is missing: {', '.join(item_missing)}")
        item_id = str(item["id"])
        if not item_id or item_id in ids:
            raise ValueError(f"confirmations[{index}] has an empty or duplicate id")
        ids.add(item_id)
        if item["kind"] not in KINDS or item["status"] not in STATUSES:
            raise ValueError(f"confirmations[{index}] has an invalid kind or status")
        if item["status"] == "active":
            active += 1
            if item.get("answer") is None:
                raise ValueError(f"confirmations[{index}] active confirmation requires an answer")
        scope = item["scope"]
        scope_keys = {"profile_fact_ids", "policy_confirmation_ids", "screening_gate_ids"}
        if not isinstance(scope, dict) or not scope_keys.issubset(scope):
            raise ValueError(f"confirmations[{index}] has an invalid scope")
        if profile:
            unknown = sorted(set(map(str, scope["profile_fact_ids"])) - fact_ids)
            if unknown:
                raise ValueError(f"confirmations[{index}] references unknown profile facts: {unknown}")
        if policy:
            unknown = sorted(set(map(str, scope["policy_confirmation_ids"])) - policy_ids)
            if unknown:
                raise ValueError(f"confirmations[{index}] references unknown policy confirmations: {unknown}")

    return {
        "candidate_id": ledger["candidate_id"],
        "confirmations": len(ledger["confirmations"]),
        "active": active,
        "fingerprint": fingerprint(ledger),
        "valid": True,
    }


def link_policy(policy: dict, ledger: dict) -> dict:
    result = json.loads(json.dumps(policy, ensure_ascii=False))
    result.setdefault("screening_gates", [])
    by_policy_id = {}
    for entry in ledger["confirmations"]:
        if entry["status"] != "active":
            continue
        for policy_id in entry["scope"]["policy_confirmation_ids"]:
            by_policy_id[str(policy_id)] = entry["id"]
    for item in result.get("confirmation_items", []):
        linked = by_policy_id.get(str(item["id"]))
        if linked:
            item["ledger_confirmation_id"] = linked
    result["confirmation_ledger"] = {
        "path": "candidate-confirmations.json",
        "candidate_id": ledger["candidate_id"],
        "as_of": ledger["as_of"],
        "fingerprint": fingerprint(ledger),
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    migrate = sub.add_parser("migrate")
    migrate.add_argument("--profile", type=Path, required=True)
    migrate.add_argument("--policy", type=Path)
    migrate.add_argument("--output", type=Path, required=True)
    migrate.add_argument("--output-policy", type=Path)
    migrate.add_argument("--as-of")
    validate = sub.add_parser("validate")
    validate.add_argument("--confirmations", type=Path, required=True)
    validate.add_argument("--profile", type=Path)
    validate.add_argument("--policy", type=Path)
    args = parser.parse_args()

    if args.command == "migrate":
        profile = load_json(args.profile)
        policy = load_json(args.policy) if args.policy else None
        ledger = migrated_ledger(profile, policy, args.as_of)
        validate_ledger(ledger, profile, policy)
        write_json(args.output, ledger)
        if args.output_policy:
            if not policy:
                raise ValueError("--output-policy requires --policy")
            write_json(args.output_policy, link_policy(policy, ledger))
        print(json.dumps(validate_ledger(ledger, profile, policy), ensure_ascii=False))
    else:
        ledger = load_json(args.confirmations)
        profile = load_json(args.profile) if args.profile else None
        policy = load_json(args.policy) if args.policy else None
        print(json.dumps(validate_ledger(ledger, profile, policy), ensure_ascii=False))


if __name__ == "__main__":
    main()
