---
name: discover-linkedin-job-postings
description: Generate and manage candidate-driven LinkedIn query portfolios, open approved searches in the authenticated Codex in-app browser, apply auditable first-level title and metadata filters, deduplicate results, and extract visible job descriptions into normalized JobPosting bundles. Use for LinkedIn job discovery, scheduled or event-triggered search runs, Boolean query testing, German-title filtering, batch JD collection, and preparing standardized JD inputs for tailor-job-application.
---

# Discover LinkedIn Job Postings

Run a bounded, auditable discovery workflow. Keep candidate facts outside reusable code, preserve skipped-result metadata, and never turn first-level discovery decisions into final fit gates.

## Inputs

Require for execution:

- an evidence-linked `candidate-profile.json`;
- a separate confirmed `job-search-policy.json`;
- a `query-portfolio.json` containing at least one reviewed `active` query;
- a manual, scheduled, or event trigger with a stable run ID.

Read `references/data-contracts.md` before creating or validating these artifacts. Read `references/linkedin-browser-workflow.md` before operating LinkedIn.

## Workflow

1. Validate that candidate facts and search policy are separate. Treat language ability as a fact and title-language handling as policy.
2. When a portfolio does not exist, run `scripts/generate_query_portfolio.py` with the candidate profile, draft or confirmed policy, and an explicit run profile. It compiles evidence-linked search targets into source-specific Boolean queries. A confirmed policy's `approved` targets become `active`; proposed targets and targets in a draft policy remain `draft`. Use the policy's daily profile for recurring production runs and a separately bounded capability-test profile when broader input is needed for evaluation.
3. Treat target approval in Skill A as authorization for its deterministic compiled query; do not ask for a duplicate query-activation confirmation. If must-groups, exclusions, or target-level filters change, return the target to `proposed` for review before execution. Never silently modify an active query.
4. Run `scripts/validate_discovery_inputs.py` before browser execution. Require matching candidate IDs and source versions. Active queries require a confirmed policy with no required open confirmation.
5. Use `scripts/linkedin_discovery.mjs` to build deterministic search URLs from query specifications.
6. Open each URL in the authenticated Codex in-app browser. Verify visible filter state once. Use UI controls only as a fallback when URL parameters fail.
7. Use `scripts/linkedin_split_pane_adapter.mjs` to collect visible result-card metadata in one pass: job ID, title, company, location, URL, query ID, and visible status markers.
8. Run title and metadata triage with `scripts/linkedin_discovery.mjs`. Use only `FORWARD`, `MANUAL_REVIEW`, and `SKIP_FIRST_LEVEL` at this stage.
9. Preserve every skipped card and its reason. Do not discard URLs or job IDs.
10. Open only forwarded or manually reviewed jobs. Prefer selecting the same-page detail pane through the search page's visible `currentJobId` URL state using a job ID collected from a visible card. Verify the title and `About the job` heading. Use a card click and then an independent job page only as bounded fallbacks. Normalize the visible JD to schema.org `JobPosting` JSON and Markdown, and record extraction warnings.
11. Checkpoint each successfully extracted job immediately. Do not wait for the full detail loop to finish before persisting it; a later navigation failure must not discard earlier results.
12. Cache by LinkedIn job ID and content hash. Merge query provenance when a job appears in more than one query.
13. Materialize a browser checkpoint with `scripts/materialize_browser_checkpoint.py`, write `run-manifest.json`, and validate it with `scripts/validate_discovery_run.py`.
14. Hand every retrieved or cached normalized JobPosting artifact directly to `tailor-job-application` for detailed screening. Do not add a human confirmation gate between validated extraction and screening.

## Decision boundary

First-level filtering may use high-confidence, reversible rules such as explicit excluded title families, incompatible seniority, internship status, title language, duplicate job IDs, and explicit card metadata.

Do not:

- infer a final candidate fit from the title alone;
- issue `PASS`, `HOLD`, or `FAIL`;
- rewrite candidate facts from search results;
- create an application case for every discovered job;
- auto-apply, auto-save, create alerts, or modify LinkedIn account state.

When the German-title policy is enabled, ignore `m/w/d`, location names, and company names as language evidence. Record the exact matched markers and policy mode. Keep `unknown` or mixed titles unless the configured policy explicitly says otherwise.

## Browser and compliance rules

- Use the Browser skill and the user-visible authenticated LinkedIn interface.
- Do not call private LinkedIn APIs or enumerate unknown job IDs.
- Keep runs bounded by the configured query and job limits.
- For daily recurring discovery, default to `Past 24 hours` and recent-first ordering. Do not reuse a broader capability-test window unless the trigger explicitly requests that profile.
- Stop on login expiry, CAPTCHA, access challenge, or material DOM change.
- Treat an empty or partially loaded result pane as an extraction warning, not as evidence that no jobs exist.
- Leave scheduling and email monitoring to the orchestration layer. Accept trigger payloads; do not monitor external systems from this skill.

## Output contract

Create one run directory containing `run-manifest.json` and a `jobs/` directory. Store one schema.org JobPosting JSON file and one readable Markdown file for each retrieved JD. Keep candidate fit claims out of JobPosting files.

Use English for artifacts, filenames, reason codes, and configuration. Communicate with the user in their preferred language.

## Tools

- `scripts/linkedin_discovery.mjs build-url <query-spec.json>`: build a deterministic LinkedIn search URL.
- `scripts/linkedin_discovery.mjs build-portfolio <query-portfolio.json>`: build URLs for active queries only.
- `scripts/generate_query_portfolio.py --profile <profile.json> --policy <policy.json> --output <portfolio.json> [--run-profile <name>]`: compile approved targets from a confirmed policy into active queries and keep unapproved targets draft.
- `scripts/validate_discovery_inputs.py --profile <profile.json> --policy <policy.json> --portfolio <portfolio.json> [--candidate-root <dir>]`: enforce candidate identity, source versions, and activation gates.
- `scripts/linkedin_discovery.mjs classify <cards.json> <policy.json>`: apply deterministic first-level title rules.
- `scripts/linkedin_split_pane_adapter.mjs`: collect visible cards, select a same-page detail by discovered job ID or exact card fallback, verify it, and extract the visible description.
- `scripts/materialize_browser_checkpoint.py <browser-checkpoint.json> --portfolio <portfolio.json> --policy <policy.json> --cache-run <prior-run-dir>`: convert independently checkpointed cards and details into normalized JobPosting artifacts and an auditable run manifest.
- `scripts/validate_discovery_run.py <run-manifest.json>`: validate run counts, decisions, artifacts, and JobPosting handoff files.
