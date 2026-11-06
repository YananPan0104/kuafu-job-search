---
name: discover-linkedin-job-postings
description: Generate and manage candidate-driven LinkedIn Smart Job Search portfolios, open approved searches in the authenticated browser, apply auditable first-level title and metadata filters, stop at related-result boundaries, deduplicate results, and extract complete visible job descriptions into normalized JobPosting bundles.
---

# Discover LinkedIn Job Postings

Run an auditable discovery workflow bounded by the approved query portfolio, visible related-results boundary, and explicit safety stops rather than an arbitrary result-count cap. Keep candidate facts outside reusable code, preserve skipped-result metadata, and never turn first-level discovery decisions into final fit gates.

## Inputs

Require for execution:

- an evidence-linked `candidate-profile.json`;
- a separate confirmed `job-search-policy.json`;
- the candidate-local `candidate-confirmations.json` when referenced by the policy;
- a `query-portfolio.json` containing at least one reviewed `active` query;
- a manual, scheduled, or event trigger with a stable run ID.

Read `references/data-contracts.md` before creating or validating these artifacts. Read `references/linkedin-browser-workflow.md` before operating LinkedIn.
For a recurring daily or recovery run, also read `references/daily-runbook.md` before execution.

## Workflow

### Prepare

1. Validate that candidate facts and search policy are separate. Treat language ability as a fact and title-language handling as policy.
2. When a portfolio does not exist, run `scripts/generate_query_portfolio.py` with the candidate profile, draft or confirmed policy, and an explicit run profile. It compiles evidence-linked search targets into positive-intent Smart Job Search queries. LinkedIn AI search does not support exclusions; retain target exclusions for deterministic first-level triage. A confirmed policy's `approved` targets become `active`; proposed targets and targets in a draft policy remain `draft`.
3. Treat target approval in Skill A as authorization for its deterministic compiled query; do not ask for a duplicate query-activation confirmation. If must-groups, exclusions, or target-level filters change, return the target to `proposed` for review before execution. Never silently modify an active query.
4. Run `scripts/validate_discovery_inputs.py` before browser execution. Require matching candidate IDs, source versions, and confirmation-ledger fingerprint and links when the policy references a ledger. Active queries require a confirmed policy with no required open confirmation.

### Discover

1. Enter Smart Job Search through the visible `Try AI job search` control and submit the exact compiled text through `Describe the job you want`. Traditional Boolean execution is unsupported. In a daily run, execute every active portfolio query and then execute the independent Top Applicant source below; it is not another compiled portfolio query.
2. Record the exact text and visible suggested filters. Apply and verify `Past 24 hours` through visible controls for daily runs. Record ranking as `semantic_relevance`; Smart Search does not expose a user-selectable sort control.
3. Use `collectSearchCardsAcrossPages` with the Smart collector. Read job IDs only from validated `componentkey=job-card-component-ref-<digits>` attributes. Do not impose a fixed 30-job limit or another arbitrary numeric result cap. Continue collecting every eligible exact-match card until the visible related-results marker or genuine result exhaustion; never collect or open cards below the marker. Ambiguous boundary state makes the query incomplete.
4. Run title and metadata triage with `scripts/linkedin_discovery.mjs`. Automatically `SKIP_FIRST_LEVEL` any job with visible `Reposted X minutes/hours/days/weeks ago` metadata and record `REPOSTED_JOB`. Use only `FORWARD`, `MANUAL_REVIEW`, and `SKIP_FIRST_LEVEL` at this stage.
5. Preserve every skipped card and its reason. Do not discard URLs or job IDs.
6. Open only forwarded or manually reviewed jobs. Expand a unique visible description-scoped `more` control and use the shared 10-second condition-check budget for each attempt. Require verified completeness and preserve but do not hand off failures.
7. Checkpoint each attempted detail immediately. Put every transient `retrieval_failed` or incomplete-description record into the same run's retry queue. After the attempt is checkpointed, wait one minute and retry that job; repeat at one-minute intervals until retrieval succeeds. Already retrieved or cached jobs must not be reopened.
8. The automatic retry rule never overrides safety stops. On login expiry, MFA, CAPTCHA, access challenge, material DOM drift, profile lock, or browser disconnection, preserve the retry queue and checkpoint, stop safely, and resume the same run after the user restores access. Do not bypass or weaken the stop condition.
9. Cache by LinkedIn job ID and content hash. Merge query provenance when a job appears in more than one query.

### Top Applicant special source

1. From the authenticated LinkedIn Jobs landing page, locate the visible heading `Jobs where you’d be a top applicant` and activate `Show all jobs where you’d be a top applicant`. Verify the destination using the same visible heading and explanatory text. Treat `origin=QUALIFICATION_LANDING` and `showHowYouFit=HOW_YOU_FIT` only as supporting evidence, never as substitutes for visible verification.
2. Open the visible `Date posted` filter, choose the radio option `Past 24 hours`, and activate `Show results`. Require both a visible `Past 24 hours` state and the corresponding filtered results before collecting cards. Record `f_TPR=r86400` as supporting URL evidence when present, but do not accept URL evidence alone.
3. Collect every visible job card on result page 1 and result page 2 only. This two-page ceiling is an intentional exception to the no-arbitrary-cap rule for normal Smart Search queries. If page 2 is unavailable after filtering, record natural exhaustion; if page 2 is available, process it and stop even when a page-3 or enabled `Next` control remains.
4. Identify cards only from validated `div[role=button][componentkey=job-card-component-ref-<digits>]` elements. Use visible pagination controls and their current-page state; never synthesize offsets. Apply the same first-level triage, detail extraction, completeness checks, one-minute retry loop, and safety stops used for portfolio results.
5. Record source provenance as `linkedin_top_applicant`, ranking provenance as `linkedin_top_applicant_recommendation`, and the observed source page number. Deduplicate by job ID against all portfolio-query results and merge both provenance paths.

### Materialize

1. Materialize the browser checkpoint with `scripts/materialize_browser_checkpoint.py`.
2. Write `run-manifest.json`, `failed-jobs.json`, `failed-jobs.md`, and the normalized files under `jobs/`.
3. Run `scripts/validate_discovery_run.py`. Treat `failed-jobs.md` as the user-facing manual-review queue with directly clickable LinkedIn links.

### Handoff

1. Hand every retrieved or cached normalized JobPosting artifact directly to `tailor-job-application` for detailed screening.
2. Do not add a human confirmation gate between validated extraction and screening. Keep application submission outside this skill.

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
- Keep normal Smart Search collection bounded by the approved query portfolio, visible related-results boundary, genuine result exhaustion, and safety stops. Do not use a fixed 30-job cap, per-query result-count cap, global result-count cap, or page-count cap for those queries; concurrency remains bounded. The independent Top Applicant source is the sole explicit two-page collection exception.
- For daily recurring discovery, require `Past 24 hours` and record Smart Search `semantic_relevance` ranking. Do not reuse a broader capability-test window unless the trigger explicitly requests that profile.
- Stop on login expiry, CAPTCHA, access challenge, or material DOM change.
- Apply the shared 10-second condition-check budget to browser connection, navigation, filters, cards, pagination, split-pane selection, and detail rendering. Successful conditions may return early; negative loading conclusions require the full budget.
- Treat an empty or partially loaded result pane as an extraction warning, not as evidence that no jobs exist.
- Leave scheduling and email monitoring to the orchestration layer. Accept trigger payloads; do not monitor external systems from this skill.

## Output contract

Create one run directory containing `run-manifest.json`, `failed-jobs.json`, `failed-jobs.md`, and a `jobs/` directory. Store one schema.org JobPosting JSON file and one readable Markdown file for each retrieved JD. For every `retrieval_failed` job, retain title, company, location, job ID, query provenance, canonical and captured source URLs, failure codes, and any partial description in the failed-job review artifacts. Keep candidate fit claims out of JobPosting and failed-job files.

Use English for artifacts, filenames, reason codes, and configuration. Communicate with the user in their preferred language.

## Tools

- `scripts/linkedin_discovery.mjs build-portfolio <query-portfolio.json>`: emit the Smart Search execution plan for active queries only.
- `scripts/generate_query_portfolio.py --profile <profile.json> --policy <policy.json> --output <portfolio.json> [--run-profile <name>]`: compile approved targets from a confirmed policy into active queries and keep unapproved targets draft.
- `scripts/validate_discovery_inputs.py --profile <profile.json> --policy <policy.json> --portfolio <portfolio.json> [--confirmations <candidate-confirmations.json>] [--candidate-root <dir>]`: enforce candidate identity, source versions, confirmation provenance, and activation gates.
- `scripts/linkedin_discovery.mjs classify <cards.json> <policy.json>`: apply deterministic first-level title rules.
- `scripts/linkedin_split_pane_adapter.mjs`: collect visible cards across bounded scrolling and visible Next controls; open discovered job IDs in independent direct-detail tabs with a maximum concurrency of 5; checkpoint each observation and settled detail; and retain same-page selection helpers as bounded fallbacks.
- `scripts/materialize_browser_checkpoint.py <browser-checkpoint.json> --portfolio <portfolio.json> --policy <policy.json> --cache-run <prior-run-dir>`: convert independently checkpointed cards and details into normalized JobPosting artifacts and an auditable run manifest.
- `scripts/validate_discovery_run.py <run-manifest.json>`: validate run counts, decisions, artifacts, and JobPosting handoff files.
