#!/usr/bin/env python3
"""Materialize screening outputs and automatic CV-generation candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from detect_jd_language import analyze_jd_language
from validate_case import validate


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def profile_fingerprint(profile: dict) -> str:
    payload = json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def load_job_description(manifest_path: Path, job: dict) -> str:
    relative = Path(str(job.get("jobposting_json", "")))
    if not relative.parts or relative.is_absolute():
        raise ValueError(f"job {job.get('job_id')} has an invalid JobPosting path")
    run_root = manifest_path.parent.resolve()
    source = (run_root / relative).resolve()
    try:
        source.relative_to(run_root)
    except ValueError as exc:
        raise ValueError(f"job {job.get('job_id')} JobPosting path leaves the discovery run") from exc
    posting = load_json(source)
    description = posting.get("description")
    if not isinstance(description, str) or not description.strip():
        raise ValueError(f"job {job.get('job_id')} JobPosting description is missing")
    return description


def validate_german_jd_gate(job: dict, screening: dict, detection: dict) -> None:
    if not detection["is_german"]:
        return
    language_requirements = [
        requirement for requirement in screening.get("requirements", [])
        if requirement.get("criterion") == "JD language is German"
    ]
    if screening.get("underlying_gate") != "FAIL" or screening.get("gate") not in {"FAIL", "OVERRIDDEN"}:
        raise ValueError(f"job {job['job_id']} has a German JD body and requires underlying FAIL")
    if "JD_LANGUAGE_GERMAN" not in screening.get("reason_codes", []):
        raise ValueError(f"job {job['job_id']} German JD FAIL lacks JD_LANGUAGE_GERMAN")
    if not language_requirements:
        raise ValueError(f"job {job['job_id']} German JD FAIL lacks its language requirement")
    requirement = language_requirements[0]
    if not (
        requirement.get("classification") == "hard"
        and requirement.get("hardness_basis") == "user_override"
        and requirement.get("candidate_status") == "unmet"
    ):
        raise ValueError(f"job {job['job_id']} German JD language requirement is invalid")
    recorded = screening.get("jd_language_detection")
    if not isinstance(recorded, dict) or recorded.get("detector_version") != detection["detector_version"]:
        raise ValueError(f"job {job['job_id']} German JD FAIL lacks current detector evidence")
    if screening.get("gate") == "OVERRIDDEN":
        authorization = screening.get("override")
        if not isinstance(authorization, dict) or authorization.get("job_id") != job["job_id"]:
            raise ValueError(f"job {job['job_id']} language override requires matching job scope")
        for field in ("user_answer", "user_message_locator"):
            if not isinstance(authorization.get(field), str) or not authorization[field].strip():
                raise ValueError(f"job {job['job_id']} language override requires {field}")
        scope = authorization.get("requirement_ids")
        if not isinstance(scope, list) or not all(isinstance(item, str) for item in scope):
            raise ValueError(f"job {job['job_id']} language override requires requirement_ids")
        unresolved = {
            item.get("id") for item in screening.get("requirements", [])
            if item.get("classification") == "hard" and item.get("candidate_status") != "met"
        }
        if not unresolved.issubset(set(scope)):
            raise ValueError(f"job {job['job_id']} has unwaived hard requirements")


def screening_markdown(job: dict, screening: dict) -> str:
    rows = []
    for requirement in screening["requirements"]:
        rows.append(
            f"| {requirement['criterion']} | {requirement['classification']} | "
            f"{requirement['candidate_status']} | {requirement['reasoning']} |"
        )
    questions = screening.get("blocking_questions") or []
    question_text = "\n".join(f"- {question}" for question in questions) or "None."
    return (
        f"# Screening — {job['title']}\n\n"
        f"- Company: {job['company']}\n"
        f"- Job ID: `{job['job_id']}`\n"
        f"- Gate: **{screening['gate']}**\n"
        f"- Recommendation: {screening['recommendation']}\n\n"
        "| Criterion | Class | Status | Reasoning |\n"
        "|---|---|---|---|\n"
        + "\n".join(rows)
        + f"\n\n## Blocking questions\n\n{question_text}\n"
    )


def materialize(candidate_path: Path, manifest_path: Path, assessments_path: Path, output_dir: Path, policy_path: Path | None = None, confirmations_path: Path | None = None) -> dict:
    candidate = load_json(candidate_path)
    manifest = load_json(manifest_path)
    assessments = load_json(assessments_path)
    policy = load_json(policy_path) if policy_path else None
    confirmations = load_json(confirmations_path) if confirmations_path else None
    if assessments.get("candidate_id") != candidate.get("candidate_id"):
        raise ValueError("assessment candidate_id does not match candidate profile")
    if assessments.get("source_run_id") != manifest.get("run_id"):
        raise ValueError("assessment source_run_id does not match discovery manifest")
    by_id = {str(job["job_id"]): job for job in manifest.get("jobs", [])}
    items = assessments.get("assessments")
    if not isinstance(items, list) or not items:
        raise ValueError("assessments must contain a non-empty assessments array")

    output_dir.mkdir(parents=True, exist_ok=True)
    counts = {"PASS": 0, "HOLD": 0, "FAIL": 0, "OVERRIDDEN": 0}
    batch_jobs = []
    seen = set()
    for index, item in enumerate(items):
        job_id = str(item.get("job_id", ""))
        if not job_id or job_id in seen:
            raise ValueError(f"assessment[{index}] has an invalid or duplicate job_id")
        seen.add(job_id)
        job = by_id.get(job_id)
        if not job:
            raise ValueError(f"assessment[{index}] job_id is absent from discovery manifest: {job_id}")
        if job.get("collection_status") not in {"retrieved", "cached"}:
            raise ValueError(f"assessment[{index}] job is not a retrieved or cached discovery artifact")
        screening = item.get("screening")
        if not isinstance(screening, dict):
            raise ValueError(f"assessment[{index}] screening must be an object")
        errors = validate(candidate, screening, policy, confirmations)
        if errors:
            raise ValueError(f"assessment[{index}] is invalid: {'; '.join(errors)}")
        if job_id not in screening.get("case_id", ""):
            raise ValueError(f"assessment[{index}] case_id must contain the job ID")
        language_detection = analyze_jd_language(load_job_description(manifest_path, job))
        validate_german_jd_gate(job, screening, language_detection)

        job_dir = output_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        write_json(job_dir / "screening-report.json", screening)
        (job_dir / "screening-report.md").write_text(screening_markdown(job, screening), encoding="utf-8")
        write_json(job_dir / "optimization-backlog.json", item.get("optimization_backlog", {"items": []}))
        (job_dir / "source-audit.md").write_text(
            f"# Source Audit\n\n- Discovery run: `{manifest['run_id']}`\n"
            f"- Job ID: `{job_id}`\n- Query IDs: {', '.join(job.get('query_ids', []))}\n"
            f"- Collection status: {job['collection_status']}\n- Canonical URL: {job['canonical_url']}\n"
            f"- JobPosting JSON: `{job['jobposting_json']}`\n- Extraction warnings: {job.get('retrieval_warning') or 'None'}\n",
            encoding="utf-8",
        )
        (job_dir / "jd-normalized.md").write_text(
            f"# Normalized JD Reference\n\nUse discovery artifact: `../../jobs/{job_id}.md`.\n",
            encoding="utf-8",
        )
        counts[screening["gate"]] += 1
        next_action = (
            "GENERATE_CV"
            if screening["gate"] in {"PASS", "OVERRIDDEN"}
            else "REQUEST_BLOCKING_FACTS"
            if screening["gate"] == "HOLD"
            else "STOP"
        )
        batch_jobs.append({
            "job_id": job_id,
            "title": job["title"],
            "company": job["company"],
            "gate": screening["gate"],
            "recommendation": screening["recommendation"],
            "screening_report": f"{job_id}/screening-report.json",
            "next_action": next_action,
            "jd_language": language_detection["language"],
        })

    application_candidates = [
        job["job_id"] for job in batch_jobs if job["next_action"] == "GENERATE_CV"
    ]
    batch = {
        "schema_version": "1.0",
        "batch_id": assessments["batch_id"],
        "candidate_id": candidate["candidate_id"],
        "candidate_profile_as_of": candidate["as_of"],
        "candidate_profile_fingerprint": profile_fingerprint(candidate),
        "confirmation_ledger": (
            {"path": str(confirmations_path), "as_of": confirmations.get("as_of")}
            if confirmations_path and confirmations
            else None
        ),
        "source_run_id": manifest["run_id"],
        "mode": "screen_and_advance",
        "application_generation": bool(application_candidates),
        "application_generation_policy": "pass_and_overridden_automatic",
        "application_candidates": application_candidates,
        "jobs": batch_jobs,
        "gate_counts": counts,
    }
    write_json(output_dir / "batch-manifest.json", batch)
    return batch


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--assessments", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--policy", type=Path)
    parser.add_argument("--confirmations", type=Path)
    args = parser.parse_args()
    result = materialize(args.candidate, args.manifest, args.assessments, args.output, args.policy, args.confirmations)
    print(json.dumps({"batch_id": result["batch_id"], "jobs": len(result["jobs"]), "gate_counts": result["gate_counts"], "valid": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
