#!/usr/bin/env python3
"""Find historical LinkedIn JobPosting artifacts that may retain collapsed text."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


MARKER = re.compile(
    r"(?:\u2026|\.\.\.)?\s*(?:show more|see more|more|mehr anzeigen)\s*$",
    re.IGNORECASE,
)


def audit(root: Path) -> dict:
    findings = []
    for path in sorted(root.glob("runs/*/jobs/*.json")):
        try:
            posting = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        description = str(posting.get("description", "")).strip()
        discovery = posting.get("discovery", {})
        reasons = []
        if MARKER.search(description):
            reasons.append("COLLAPSED_MARKER_RETAINED")
        if str(discovery.get("description_completeness", "")).startswith("incomplete_"):
            reasons.append("INCOMPLETE_EXTRACTION_METADATA")
        if (discovery.get("description_expansion") or {}).get("outcome") in {
            "failed", "ambiguous_control", "marker_without_control"
        }:
            reasons.append("EXPANSION_NOT_VERIFIED")
        if reasons:
            job_id = str(discovery.get("job_id") or path.stem)
            findings.append({
                "job_id": job_id,
                "title": posting.get("title", ""),
                "artifact": str(path.relative_to(root)).replace("\\", "/"),
                "review_url": posting.get("url") or f"https://www.linkedin.com/jobs/view/{job_id}/",
                "reason_codes": sorted(set(reasons)),
                "action": "refresh_or_manual_review",
            })
    return {"schema_version": "1.0", "root": str(root), "count": len(findings), "jobs": findings}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.root.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": result["count"], "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
