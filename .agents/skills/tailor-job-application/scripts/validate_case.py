#!/usr/bin/env python3
"""Validate candidate and screening artifacts plus gate consistency."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

FACT_STATUS = {"verified", "source_claimed", "needs_confirmation", "expired"}
CLASSIFICATIONS = {"hard", "soft", "learnable"}
MATCHES = {"met", "partial", "unmet", "unknown"}
GATES = {"PASS", "HOLD", "FAIL", "OVERRIDDEN"}


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


def validate(candidate: dict, screening: dict) -> list[str]:
    errors: list[str] = []
    require(candidate, {"schema_version", "candidate_id", "as_of", "facts", "conflicts", "unverified_claims"}, "candidate", errors)
    for i, fact in enumerate(candidate.get("facts", [])):
        require(fact, {"id", "category", "value", "status", "sources"}, f"fact[{i}]", errors)
        if fact.get("status") not in FACT_STATUS:
            errors.append(f"fact[{i}] has invalid status")
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
    args = parser.parse_args()
    errors = validate(json.loads(args.candidate.read_text(encoding="utf-8")), json.loads(args.screening.read_text(encoding="utf-8")))
    print(json.dumps({"valid": not errors, "errors": errors}, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
