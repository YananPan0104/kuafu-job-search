#!/usr/bin/env python3

import json
import tempfile
from pathlib import Path

from audit_discovery_descriptions import audit


with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    jobs = root / "runs" / "historical" / "jobs"
    jobs.mkdir(parents=True)
    (jobs / "101.json").write_text(json.dumps({
        "@type": "JobPosting",
        "title": "Junior BI Analyst",
        "description": "A long description " + ("x" * 350) + " … more",
        "url": "https://www.linkedin.com/jobs/view/101/",
    }), encoding="utf-8")
    (jobs / "2.json").write_text(json.dumps({
        "@type": "JobPosting", "title": "Complete", "description": "Complete responsibilities."
    }), encoding="utf-8")
    result = audit(root)
    assert result["count"] == 1
    assert result["jobs"][0]["job_id"] == "101"
    assert result["jobs"][0]["action"] == "refresh_or_manual_review"

print("discovery description audit tests passed")
