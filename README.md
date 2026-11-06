# Kuafu Job Search

Kuafu is a candidate-driven Codex workflow for preparing a verified candidate fact base, discovering recent LinkedIn job postings, screening them against hard requirements, and generating evidence-bound application documents for suitable roles.

The project is an MVP. It supports a human-triggered daily run in Codex and keeps application submission outside the automation boundary.

## Included skills

- `prepare-candidate-job-search`: converts raw evidence and durable candidate confirmations into a canonical, evidence-linked candidate profile and a reviewable search policy.
- `discover-linkedin-job-postings`: compiles approved search targets into LinkedIn queries, performs auditable first-level filtering, deduplicates results, and normalizes visible job descriptions.
- `tailor-job-application`: screens requirements, drafts a CV and optional cover letter, obtains independent draft review, resolves feedback, and generates documents with final visual and text QA. It also supports review-only requests.

The skills are stored in `.agents/skills/`. After cloning and opening the repository as a Codex workspace, Codex can discover these repo-local skills automatically.

These are three skills, not three agents that run on every request. With a directly supplied JD, valid candidate evidence is reused and discovery is skipped. One content owner handles the job; for a single job the root may fill that role, but a separate reviewer starts without inherited chat history. Multi-skill tasks use serial stage handoffs, while different jobs keep separate execution contexts. Model defaults and escalation rules live in [AGENTS.md](AGENTS.md); verify the actual worker model at dispatch. These instructions do not change the app's model picker or provide a programmatic model-routing guarantee.

The content sequence is **draft -> independent review -> feedback resolution -> DOCX/PDF -> final page and text QA**. Supported editorial refinements run automatically. New facts, ambiguous claims or metrics, evidence conflicts, and deletion, omission, or material compression of key experience need an explicit, scoped user approval before changing affected content, including in the initial draft. See the [draft-review procedure](.agents/skills/tailor-job-application/references/draft-content-review.md). The existing builder does not programmatically enforce this approval contract.

## Privacy boundary

Reusable skill code and documentation are tracked in Git. Candidate CVs, profiles, confirmation ledgers, policies, collected job descriptions, screening results, and generated application files are local runtime data and are ignored by Git.

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

The number of search targets is candidate-dependent rather than fixed. Approved targets become the active query portfolio; daily runs use the `Past 24 hours` window, while broader windows are reserved for recovery or capability testing. The exact daily-scan aliases in `AGENTS.md` stop after validated discovery and JD extraction; the end-to-end prompt above explicitly requests the later stages.

If you already have a JD and a valid candidate profile, provide the URL, complete text, or file and request a CV, plus a cover letter if wanted. Tailoring proceeds directly through draft review; it does not start a new job search. Pending fit facts or sensitive content approvals checkpoint the case before final generation.

## Verification

Run all current script tests from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/test.ps1
```

Python tests use only project scripts except for document-generation features, which require `python-docx`. Browser extraction runs through the authenticated Codex in-app browser rather than a private LinkedIn API.

## Documentation

- [Architecture and control boundaries](docs/architecture/job-discovery-pipeline.md)
- [Daily discovery runbook](.agents/skills/discover-linkedin-job-postings/references/daily-runbook.md)
- [Draft review and approval boundaries](.agents/skills/tailor-job-application/references/draft-content-review.md)
- [中文项目介绍](docs/zh-CN/project-introduction.md)
- [中文端到端流程](docs/zh-CN/job-search-pipeline.md)

## Current limitations

- Daily execution is conversational, not an unattended background schedule.
- Login expiry, CAPTCHA, access challenges, and material LinkedIn page changes require human intervention.
- Durable cross-stage resume, atomic state transitions, workspace locking, quotas, and external notifications are deferred.
- The project does not auto-apply, auto-save jobs, create alerts, or mutate a LinkedIn account.

No license is granted at this stage. The repository is intended for private evaluation and controlled candidate testing.
