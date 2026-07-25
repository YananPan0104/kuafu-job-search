# Kuafu Job Search

Kuafu is a candidate-driven Codex workflow for preparing a verified candidate fact base, discovering recent LinkedIn job postings, screening them against hard requirements, and generating evidence-bound application documents for suitable roles.

The project is an MVP. It supports a human-triggered daily run in Codex and keeps application submission outside the automation boundary.

## Included skills

- `prepare-candidate-job-search`: converts a raw CV and supporting evidence into a canonical, evidence-linked candidate profile and a reviewable search policy.
- `discover-linkedin-job-postings`: compiles approved search targets into LinkedIn queries, performs auditable first-level filtering, deduplicates results, and normalizes visible job descriptions.
- `tailor-job-application`: performs detailed requirement screening and produces auditable ATS CV and cover-letter proposals for jobs that pass the hard gates.

The skills are stored in `.agents/skills/`. After cloning and opening the repository as a Codex workspace, Codex can discover these repo-local skills automatically.

## Privacy boundary

Reusable skill code and documentation are tracked in Git. Candidate CVs, profiles, policies, collected job descriptions, screening results, and generated application files are local runtime data and are ignored by Git.

Before adding files, verify that they contain no real candidate name, contact details, employer-confidential information, credentials, or machine-specific paths.

## Quick start

1. Clone the repository and open its root folder in Codex.
2. Provide a candidate CV in DOCX or PDF format and invoke `prepare-candidate-job-search`.
3. Review and resolve the material search preferences proposed by Codex.
4. Sign in to LinkedIn in the Codex in-app browser.
5. Start a daily run with a prompt such as:

   ```text
   Run today's job search for <candidate-id>. Use the active daily query portfolio and Past 24 hours. Continue automatically through JD extraction and detailed screening, then generate and QA application documents for PASS jobs. Stop for LinkedIn authentication challenges or unresolved HOLD facts. Do not submit applications.
   ```

The number of search targets is candidate-dependent rather than fixed. Approved targets become the active query portfolio; daily runs use the `Past 24 hours` window, while broader windows are reserved for recovery or capability testing.

## Verification

Run all current script tests from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/test.ps1
```

Python tests use only project scripts except for document-generation features, which require `python-docx`. Browser extraction runs through the authenticated Codex in-app browser rather than a private LinkedIn API.

## Documentation

- [Architecture and control boundaries](docs/architecture/job-discovery-pipeline.md)
- [中文项目介绍](docs/zh-CN/project-introduction.md)
- [中文端到端流程](docs/zh-CN/job-search-pipeline.md)

## Current limitations

- Daily execution is conversational, not an unattended background schedule.
- Login expiry, CAPTCHA, access challenges, and material LinkedIn page changes require human intervention.
- Durable cross-stage resume, atomic state transitions, workspace locking, quotas, and external notifications are deferred.
- The project does not auto-apply, auto-save jobs, create alerts, or mutate a LinkedIn account.

No license is granted at this stage. The repository is intended for private evaluation and controlled candidate testing.
