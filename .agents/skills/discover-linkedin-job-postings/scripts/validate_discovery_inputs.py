#!/usr/bin/env python3
"""Validate profile, policy, and query-portfolio identity and activation gates."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def ensure_inside(path: Path, root: Path, label: str) -> None:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"{label} must stay inside candidate root {root}") from exc


def profile_fingerprint(profile: dict) -> str:
    payload = json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def validate_inputs(profile: dict, policy: dict, portfolio: dict) -> dict:
    ids = {
        "profile": str(profile.get("candidate_id", "")),
        "policy": str(policy.get("candidate_id", "")),
        "policy_source_profile": str(policy.get("source_profile", {}).get("candidate_id", "")),
        "portfolio": str(portfolio.get("candidate_id", "")),
    }
    if "" in ids.values() or len(set(ids.values())) != 1:
        raise ValueError(f"candidate_id mismatch across discovery inputs: {ids}")
    if policy.get("source_profile", {}).get("as_of") != profile.get("as_of"):
        raise ValueError("policy source_profile.as_of does not match candidate profile as_of")
    if portfolio.get("source_profile_as_of") != profile.get("as_of"):
        raise ValueError("portfolio source_profile_as_of does not match candidate profile as_of")
    actual_fingerprint = profile_fingerprint(profile)
    policy_fingerprint = policy.get("source_profile", {}).get("fingerprint")
    portfolio_fingerprint = portfolio.get("source_profile_fingerprint")
    if policy_fingerprint and policy_fingerprint != actual_fingerprint:
        raise ValueError("policy source_profile fingerprint does not match candidate profile")
    if portfolio_fingerprint and portfolio_fingerprint != actual_fingerprint:
        raise ValueError("portfolio source_profile_fingerprint does not match candidate profile")
    if portfolio.get("source_policy_version") != policy.get("policy_version"):
        raise ValueError("portfolio source_policy_version does not match policy_version")
    run_profile = portfolio.get("run_profile")
    if run_profile:
        profile_config = policy.get("run_profiles", {}).get(run_profile)
        if profile_config is None:
            raise ValueError(f"portfolio references unknown run profile: {run_profile}")
        if portfolio.get("collection_limit") != profile_config.get("collection_limit"):
            raise ValueError("portfolio collection_limit does not match its run profile")
    queries = portfolio.get("queries")
    if not isinstance(queries, list) or not queries:
        raise ValueError("query portfolio must contain at least one query")
    invalid_statuses = [query.get("query_id") for query in queries if query.get("status") not in {"draft", "active", "retired"}]
    if invalid_statuses:
        raise ValueError(f"queries have invalid status: {invalid_statuses}")
    active = [query for query in queries if query.get("status") == "active"]
    open_required = [
        item.get("id")
        for item in policy.get("confirmation_items", [])
        if item.get("required") is True and item.get("status") != "resolved"
    ]
    if active and policy.get("status") != "confirmed":
        raise ValueError("active queries require a confirmed job-search policy")
    if active and open_required:
        raise ValueError(f"active queries are blocked by open required confirmations: {open_required}")
    return {
        "candidate_id": ids["profile"],
        "policy_status": policy.get("status"),
        "queries": len(queries),
        "active_queries": len(active),
        "open_required_confirmations": len(open_required),
        "run_profile": run_profile,
        "valid": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--portfolio", type=Path, required=True)
    parser.add_argument("--candidate-root", type=Path)
    args = parser.parse_args()
    if args.candidate_root:
        ensure_inside(args.profile, args.candidate_root, "profile")
        ensure_inside(args.policy, args.candidate_root, "policy")
        ensure_inside(args.portfolio, args.candidate_root, "portfolio")
    result = validate_inputs(load_json(args.profile), load_json(args.policy), load_json(args.portfolio))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
