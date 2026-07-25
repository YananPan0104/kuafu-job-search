#!/usr/bin/env python3
"""Compile evidence-linked search targets into a draft LinkedIn query portfolio."""

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


def require_keys(value: dict, keys: set[str], label: str) -> None:
    missing = sorted(keys - value.keys())
    if missing:
        raise ValueError(f"{label} is missing: {', '.join(missing)}")


def profile_fingerprint(profile: dict) -> str:
    payload = json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def linkedin_term(value: object) -> str:
    term = str(value).strip()
    if not term:
        raise ValueError("query terms must be non-empty")
    if any(operator in term.upper().split() for operator in ("AND", "OR", "NOT")):
        raise ValueError(f"query term must not contain Boolean operators: {term}")
    escaped = term.replace('"', '\\"')
    return f'"{escaped}"' if any(character.isspace() for character in term) else escaped


def statement_for(target: dict) -> str:
    groups = []
    for group in target["must_groups"]:
        terms = [linkedin_term(term) for term in group["terms"]]
        if not terms:
            raise ValueError(f"target {target['target_id']} contains an empty must group")
        groups.append(f"({' OR '.join(terms)})")
    statement = " AND ".join(groups)
    excluded = [linkedin_term(term) for term in target.get("exclude_terms", [])]
    if excluded:
        statement += f" NOT ({' OR '.join(excluded)})"
    return statement


def generate_portfolio(profile: dict, policy: dict, run_profile: str | None = None) -> dict:
    require_keys(profile, {"candidate_id", "as_of", "facts"}, "candidate profile")
    require_keys(policy, {"candidate_id", "policy_version", "as_of", "status", "source_profile", "default_filters", "search_targets"}, "job-search policy")
    ids = {str(profile["candidate_id"]), str(policy["candidate_id"]), str(policy["source_profile"].get("candidate_id"))}
    if len(ids) != 1:
        raise ValueError(f"candidate_id mismatch between profile and policy: {sorted(ids)}")
    expected_fingerprint = policy["source_profile"].get("fingerprint")
    actual_fingerprint = profile_fingerprint(profile)
    if expected_fingerprint and expected_fingerprint != actual_fingerprint:
        raise ValueError("policy source_profile fingerprint does not match candidate profile")
    if policy["status"] not in {"draft", "confirmed"}:
        raise ValueError("policy status must be draft or confirmed")

    selected_profile = run_profile or policy.get("default_run_profile")
    profile_config = {}
    if selected_profile:
        profiles = policy.get("run_profiles", {})
        if selected_profile not in profiles:
            raise ValueError(f"unknown run profile: {selected_profile}")
        profile_config = profiles[selected_profile]

    queries = []
    seen_ids = set()
    for index, target in enumerate(policy["search_targets"]):
        require_keys(target, {"target_id", "purpose", "must_groups", "exclude_terms", "rationale", "known_noise", "status"}, f"search_targets[{index}]")
        if target["status"] == "retired":
            continue
        query_id = str(target.get("query_id") or target["target_id"]).strip()
        if not query_id or query_id in seen_ids:
            raise ValueError(f"invalid or duplicate query_id: {query_id}")
        seen_ids.add(query_id)
        filters = {
            **policy["default_filters"],
            **profile_config.get("filter_overrides", {}),
            **target.get("filters", {}),
        }
        query_status = (
            "active"
            if policy["status"] == "confirmed" and target["status"] == "approved"
            else "draft"
        )
        queries.append({
            "query_id": query_id,
            "purpose": target["purpose"],
            "statement": statement_for(target),
            "status": query_status,
            "filters": filters,
            "rationale": target["rationale"],
            "known_noise": target["known_noise"],
            "source_target_id": target["target_id"],
            "evidence_fact_ids": target.get("evidence_fact_ids", []),
            "confirmation_ids": target.get("confirmation_ids", []),
        })
    if not queries:
        raise ValueError("policy contains no non-retired search targets")

    output = {
        "schema_version": "1.0",
        "candidate_id": profile["candidate_id"],
        "as_of": policy["as_of"],
        "portfolio_version": f"draft-from-{policy['policy_version']}",
        "source_profile_as_of": profile["as_of"],
        "source_profile_fingerprint": actual_fingerprint,
        "source_policy_version": policy["policy_version"],
        "queries": queries,
    }
    if selected_profile:
        output["run_profile"] = selected_profile
        output["collection_limit"] = profile_config.get("collection_limit")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-profile")
    args = parser.parse_args()
    portfolio = generate_portfolio(load_json(args.profile), load_json(args.policy), args.run_profile)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(portfolio, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    active_queries = sum(query["status"] == "active" for query in portfolio["queries"])
    print(json.dumps({"candidate_id": portfolio["candidate_id"], "queries": len(portfolio["queries"]), "active_queries": active_queries, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
