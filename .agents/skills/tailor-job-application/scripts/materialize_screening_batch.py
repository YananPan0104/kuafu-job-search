#!/usr/bin/env python3
"""Materialize screening outputs and automatic CV-generation candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

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


def materialize(candidate_path: Path, manifest_path: Path, assessments_path: Path, output_dir: Path) -> dict:
    candidate = load_json(candidate_path)
    manifest = load_json(manifest_path)
    assessments = load_json(assessments_path)
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
        errors = validate(candidate, screening)
        if errors:
            raise ValueError(f"assessment[{index}] is invalid: {'; '.join(errors)}")
        if job_id not in screening.get("case_id", ""):
            raise ValueError(f"assessment[{index}] case_id must contain the job ID")

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
    args = parser.parse_args()
    result = materialize(args.candidate, args.manifest, args.assessments, args.output)
    print(json.dumps({"batch_id": result["batch_id"], "jobs": len(result["jobs"]), "gate_counts": result["gate_counts"], "valid": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
