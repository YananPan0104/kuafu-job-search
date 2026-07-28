#!/usr/bin/env python3
"""Validate candidate and screening artifacts plus gate consistency."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

FACT_STATUS = {"verified", "source_claimed", "needs_confirmation", "expired"}
CLASSIFICATIONS = {"hard", "soft", "learnable"}
MATCHES = {"met", "partial", "unmet", "unknown"}
GATES = {"PASS", "HOLD", "FAIL", "OVERRIDDEN"}
HARDNESS_BASES = {"explicit", "role_critical_inference", "candidate_policy", "user_override", "not_applicable"}


def require(value: dict, keys: set[str], label: str, errors: list[str]) -> None:
    missing = sorted(keys - value.keys())
    if missing:
        errors.append(f"{label} missing keys: {', '.join(missing)}")


def expected_gate(requirements: list[dict]) -> str:
    states = [r.get("candidate_status") for r in requirements if r.get("classification") == "hard"]
    if "unmet" in states:
        return "FAIL"
    if any(state in {"partial", "unknown"} for state in states):
        return "HOLD"
    return "PASS"


def artifact_fingerprint(value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def validate(candidate: dict, screening: dict, policy: dict | None = None, confirmations: dict | None = None) -> list[str]:
    errors: list[str] = []
    require(candidate, {"schema_version", "candidate_id", "as_of", "facts", "conflicts", "unverified_claims"}, "candidate", errors)
    for i, fact in enumerate(candidate.get("facts", [])):
        require(fact, {"id", "category", "value", "status", "sources"}, f"fact[{i}]", errors)
        if fact.get("status") not in FACT_STATUS:
            errors.append(f"fact[{i}] has invalid status")
    if (policy is None) != (confirmations is None):
        errors.append("policy and confirmation ledger must be supplied together")
    if policy is not None and confirmations is not None:
        candidate_ids = {str(candidate.get("candidate_id", "")), str(policy.get("candidate_id", "")), str(confirmations.get("candidate_id", ""))}
        if "" in candidate_ids or len(candidate_ids) != 1:
            errors.append("candidate_id mismatch across candidate, policy, and confirmation ledger")
        ledger_ref = policy.get("confirmation_ledger", {})
        if ledger_ref.get("fingerprint") != artifact_fingerprint(confirmations):
            errors.append("policy confirmation_ledger fingerprint does not match confirmation ledger")
    require(screening, {"schema_version", "case_id", "gate", "underlying_gate", "recommendation", "requirements", "blocking_questions", "override"}, "screening", errors)
    if screening.get("gate") not in GATES:
        errors.append("screening has invalid gate")
    keys = {"id", "criterion", "classification", "hardness_basis", "candidate_status", "jd_evidence", "candidate_evidence", "confidence", "reasoning", "follow_up_question"}
    for i, req in enumerate(screening.get("requirements", [])):
        require(req, keys, f"requirement[{i}]", errors)
        if req.get("classification") not in CLASSIFICATIONS:
            errors.append(f"requirement[{i}] has invalid classification")
        if req.get("candidate_status") not in MATCHES:
            errors.append(f"requirement[{i}] has invalid candidate_status")
        if req.get("hardness_basis") not in HARDNESS_BASES:
            errors.append(f"requirement[{i}] has invalid hardness_basis")
        if req.get("hardness_basis") == "candidate_policy":
            evidence = req.get("policy_evidence")
            if not isinstance(evidence, dict):
                errors.append(f"requirement[{i}] candidate_policy requires policy_evidence")
            elif policy is None or confirmations is None:
                errors.append(f"requirement[{i}] candidate_policy requires policy and confirmation ledger inputs")
            else:
                policy_id = str(evidence.get("policy_confirmation_id", ""))
                ledger_id = str(evidence.get("ledger_confirmation_id", ""))
                gate_id = str(evidence.get("screening_gate_id", ""))
                policy_items = {str(item.get("id")): item for item in policy.get("confirmation_items", [])}
                ledger_items = {str(item.get("id")): item for item in confirmations.get("confirmations", []) if item.get("status") == "active"}
                screening_gates = {str(item.get("id")): item for item in policy.get("screening_gates", []) if item.get("status") == "active"}
                if policy_id not in policy_items or policy_items[policy_id].get("status") != "resolved":
                    errors.append(f"requirement[{i}] policy_evidence does not reference a resolved policy item")
                ledger_item = ledger_items.get(ledger_id, {})
                if ledger_id not in ledger_items or policy_id not in ledger_item.get("scope", {}).get("policy_confirmation_ids", []):
                    errors.append(f"requirement[{i}] policy_evidence does not reference an active scoped ledger confirmation")
                elif policy_items.get(policy_id, {}).get("answer") != ledger_item.get("answer"):
                    errors.append(f"requirement[{i}] policy answer differs from confirmation ledger")
                gate = screening_gates.get(gate_id)
                if not gate or gate.get("confirmation_id") != policy_id or gate.get("ledger_confirmation_id") != ledger_id:
                    errors.append(f"requirement[{i}] policy_evidence does not reference an active matching screening gate")
                elif gate_id not in ledger_item.get("scope", {}).get("screening_gate_ids", []):
                    errors.append(f"requirement[{i}] screening gate is absent from ledger scope")
    expected = expected_gate(screening.get("requirements", []))
    if screening.get("underlying_gate") != expected:
        errors.append(f"underlying_gate should be {expected}")
    if screening.get("gate") != "OVERRIDDEN" and screening.get("gate") != expected:
        errors.append(f"gate should be {expected} unless overridden")
    if screening.get("gate") == "OVERRIDDEN" and not screening.get("override"):
        errors.append("OVERRIDDEN requires override details")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--screening", type=Path, required=True)
    parser.add_argument("--policy", type=Path)
    parser.add_argument("--confirmations", type=Path)
    args = parser.parse_args()
    policy = json.loads(args.policy.read_text(encoding="utf-8")) if args.policy else None
    confirmations = json.loads(args.confirmations.read_text(encoding="utf-8")) if args.confirmations else None
    errors = validate(json.loads(args.candidate.read_text(encoding="utf-8")), json.loads(args.screening.read_text(encoding="utf-8")), policy, confirmations)
    print(json.dumps({"valid": not errors, "errors": errors}, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
