# LinkedIn Browser Workflow

## Preconditions

- Use the Codex in-app browser selected by the user or the runtime.
- Confirm that LinkedIn is signed in before starting a run.
- Load the active query portfolio and job-search policy from local artifacts.
- Do not set a fixed 30-job limit or another arbitrary result-count/page-count cap for a production scan.

## Unified loading budget

Use the shared loading policy for browser connection, navigation, filter rendering, result-card append, pagination, split-pane selection, and job-detail rendering. Each loading event gets a maximum 10-second condition-check budget with checks after 1, 2, 3, and 4 seconds (10 seconds cumulative), plus the initial immediate observation. A successful condition ends the wait early. Do not declare timeout, exhaustion, DOM drift, missing detail, or pagination failure after only 1-3 seconds.

## Search setup

1. Open LinkedIn Jobs and use the visible `Try AI job search` entry.
2. Submit the compiled query through the visible `Describe the job you want` input.
3. Record the exact submitted text and suggested filters.
4. Apply and read visible filter chips and compare them with the requested filters.
5. When a filter is missing, use the visible UI to correct only that filter and record the fallback.
6. Stop when the search opens an authentication challenge or CAPTCHA.

LinkedIn filter codes used by the URL builder are implementation details. Keep human-readable filter values in query artifacts.

## Top Applicant special source

Run this source independently after the active Smart Search portfolio; do not compile it as another query.

1. On the authenticated Jobs landing page, require the visible heading `Jobs where you’d be a top applicant` and use the visible `Show all jobs where you’d be a top applicant` link.
2. Verify the results view by its visible Top Applicant heading and explanatory text. URL parameters such as `origin=QUALIFICATION_LANDING` or `showHowYouFit=HOW_YOU_FIT` are supporting evidence only.
3. Open `Filter by Date posted`, select the accessible radio `Past 24 hours`, then activate the `Show results` link. Verify the radio/visible filter state and refreshed results. `f_TPR=r86400` may corroborate the state but cannot replace UI verification.
4. Read cards from visible `div[role="button"]` elements whose `componentkey` matches `job-card-component-ref-<digits>`. Current production observations show 25 cards per page, but this is not a contractual count.
5. Collect all cards on page 1, advance through the visible pagination control, collect all cards on page 2, and stop. On this responsive LinkedIn view pagination may expose named `Page 1`/`Page 2` controls with `aria-current`, or only visible `Previous`/`Next` controls. Use the result-list pagination control, not an unrelated carousel control, and never synthesize `start` offsets.
6. If no second page exists after applying `Past 24 hours`, record `EXHAUSTED_RESULTS`. After page 2 record `TOP_APPLICANT_TWO_PAGE_LIMIT_REACHED`, even if an enabled `Next` control remains. Never visit page 3.
7. Record source mode `linkedin_top_applicant`, ranking mode `linkedin_top_applicant_recommendation`, page number, visible filter verification, and supporting URL evidence. Deduplicate by job ID and merge source provenance with portfolio-query provenance before triage and extraction.

The two-page stop is an explicit product-policy limit for this special source. It does not authorize page or result-count caps for normal Smart Search collection.

## Card collection

Read Smart result cards only above the exact-match boundary. Capture job ID from a validated `componentkey` value matching `job-card-component-ref-<digits>`; do not click, enumerate, or invent IDs to discover them.

Stop with `RELATED_RESULTS_BOUNDARY_REACHED` when the visible related-results marker appears. Cards below it never enter deduplication, triage, cache, or extraction. Ambiguous or unobservable boundary state makes the query incomplete.

Deduplicate cards by job ID. When no job ID is available, use canonical URL and mark the identifier confidence accordingly. Merge query IDs rather than storing duplicate job records.

Run the deterministic title classifier before detail navigation. Preserve rejected cards in the manifest.

LinkedIn may append additional cards after the first next-page action and later switch to `start=<offset>` pagination. Deduplicate after every observation and continue until the visible related-results boundary or genuine exhaustion rather than stopping at an arbitrary number of unique job IDs.

Use `collectSearchCardsAcrossPages` for production collection. It performs result-list scrolling, follows only a visible Next control or its visible href, and checkpoints every observation. Never synthesize `start=<offset>` values. Re-verify the requested visible filters after each successful advance. Stop with an explicit reason when the related-results boundary is reached, results are exhausted, pagination makes no progress after the full loading budget, filters are lost, or a mandatory safety stop occurs. Do not stop merely because 30 jobs, a configured result count, or a page count has been reached.

Ignore legacy `collection_limit`, `maxCardsPerQuery`, global result-limit, and maximum-page-budget values as production stopping conditions. Record them as deprecated configuration when present, but collect to the boundary or exhaustion. Continue recording pages observed, unique cards collected, and the actual stop reason under `query_progress`.

## Detail collection

Open only `FORWARD` and configured `MANUAL_REVIEW` jobs. Use `extractJobDetailsInParallel` from `scripts/linkedin_split_pane_adapter.mjs` as the primary detail path. It opens canonical `/jobs/view/<discovered-id>/` pages in independent tabs, with a default and hard maximum concurrency of 5. Never use an ID that was not collected from a visible result card.

For each direct-detail tab:

1. Verify the canonical URL contains the discovered job ID and the expected title is visible.
2. Accept `About the job`, `Über den Job`, or `Infos zur Stelle` as the description heading.
3. When the description is not initially visible, scroll once to trigger lazy rendering.
4. Use bounded condition checks after 1, 2, 3, and 4 seconds (10 seconds cumulative) rather than one immediate fixed-time decision.
5. Extract and checkpoint the result as soon as that job settles; do not wait for the full parallel batch before persisting it.
6. Close the job's temporary tab after its checkpoint callback completes.

Use `Promise.allSettled` semantics so one failed job does not discard other results. Reject configurations above concurrency 5. Stop assigning new jobs when any worker detects login expiry or an access challenge.

Use `navigateAndExtractSplitPane` as the first per-job fallback: add the discovered job ID to the original search URL as `currentJobId`, navigate, and verify the expected title plus the visible description heading. Use `selectAndExtractSplitPane` as the second fallback: return to the search page, verify the captured card identity, and click a unique accessible title or job-ID link.

Treat selection verification as mandatory. If the exact link is absent or non-unique, record a warning and do not guess by card position. After the two bounded same-page fallbacks fail, checkpoint `retrieval_failed` and return the job to the controller's one-minute retry queue.

For a direct `/jobs/view/<id>/` page, use staged rendering: observe the header, scroll once to the description region, then verify a supported description heading. When it is still absent, use the bounded 1, 2, 3, and 4 second condition checks (10 seconds cumulative) for that attempt. Checkpoint `retrieval_failed` after that schedule; the controller waits one minute before starting a fresh attempt.

Expand only a unique visible control inside the supported description section. Re-read after expansion and verify that no collapsed marker or scoped control remains. Record failed or ambiguous expansion as `incomplete_description`; preserve partial text and block downstream handoff.

Persist each detail attempt immediately, keyed by LinkedIn job ID. For a failed attempt, preserve the discovered card, captured source URL, canonical job URL, extraction warnings, and any partial description. A batch controller must resume from this checkpoint and skip already retrieved IDs. Do not keep the only copy of completed descriptions or failed-job review links in an in-memory loop that can fail on a later navigation.

After each retryable failure is checkpointed, wait one minute before retrying that job. Repeat at one-minute intervals until the description is completely retrieved. Do not mark the run complete while retryable failures remain. Login expiry, MFA, CAPTCHA, access challenge, material DOM drift, profile lock, or browser disconnection are not retryable extraction failures: preserve the queue, stop safely, and resume only after access is restored. Never bypass these conditions.

If direct-detail navigation becomes unavailable after cards have already been collected, retain the original card and query provenance and use only the bounded same-page fallbacks above. This never authorizes guessing or enumerating job IDs.

## Run completion

Write artifacts locally, validate the manifest, and report:

- search initialization duration;
- cards discovered;
- title-level skips;
- details opened;
- retrieved descriptions;
- cache hits;
- retrieval failures;
- filter fallbacks.

Also materialize `failed-jobs.json` and `failed-jobs.md` even when the failed count is zero. When failures exist, report the Markdown file as the manual-review queue so the user can open each job directly.

Do not save, apply, follow companies, create alerts, or change LinkedIn settings.
