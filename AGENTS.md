# Repository instructions

- Keep reusable skill logic candidate-neutral. Candidate facts, CVs, job descriptions, screening outputs, and generated application documents belong in ignored runtime directories.
- Treat `.agents/skills/` as the canonical source for repo-local Codex skills.
- Preserve evidence provenance across candidate profiles, search policies, discovery artifacts, screening decisions, and tailored documents.
- Do not automate job application submission or bypass authentication, access controls, challenges, or private APIs.
- Prefer English for code, identifiers, comments, configuration, commit messages, and reusable documentation. Candidate-facing documentation may be localized.
- Run `scripts/test.ps1` before committing changes to skill scripts.

## Conversational trigger aliases

- Treat `开启今日职位扫描` and `开始今日职位扫描` as exact project-level aliases for the following instruction: use the dedicated persistent Chrome profile to run the `yanan-pan` Phase 1-3 daily discovery workflow with the full active daily portfolio; validate inputs, prevent duplicate daily runs, verify visible `Past 24 hours` and `Most recent` filters, collect and deduplicate cards, apply first-level triage, extract and checkpoint JDs, materialize and validate the discovery run, then stop before screening, document generation, scheduling, or application actions.
- On login expiry, MFA, CAPTCHA, access challenge, material DOM drift, incomplete visible-filter verification, profile lock, or browser disconnection, preserve the checkpoint, stop safely, and report the required user action. Never weaken these stop conditions to satisfy the alias.
- If a run for the same daily trigger already exists, do not silently create a duplicate. Report it as complete, resumable, or requiring an explicitly named recovery run.
