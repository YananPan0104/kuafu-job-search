# LinkedIn Browser Workflow

## Preconditions

- Use the Codex in-app browser selected by the user or the runtime.
- Confirm that LinkedIn is signed in before starting a run.
- Load the active query portfolio and job-search policy from local artifacts.
- Set an explicit per-query result limit.

## Search setup

1. Import `scripts/linkedin_discovery.mjs` in the browser-control JavaScript session.
2. Build the URL from the query statement and filters.
3. Navigate directly to the generated URL.
4. Read the visible filter chips and compare them with the requested filters.
5. When a filter is missing, use the visible UI to correct only that filter and record the fallback.
6. Stop when the search opens an authentication challenge or CAPTCHA.

LinkedIn filter codes used by the URL builder are implementation details. Keep human-readable filter values in query artifacts.

## Card collection

Read all currently visible result cards before opening a detail pane. Use `collectVisibleJobCards` from `scripts/linkedin_split_pane_adapter.mjs` for the bounded DOM read. Capture job ID from a visible `/jobs/view/<id>` link when possible and preserve the exact `source_href` for later selection. Do not invent an ID when the page omits one.

Deduplicate cards by job ID. When no job ID is available, use canonical URL and mark the identifier confidence accordingly. Merge query IDs rather than storing duplicate job records.

Run the deterministic title classifier before detail navigation. Preserve rejected cards in the manifest.

LinkedIn may append additional cards after the first next-page action and later switch to `start=<offset>` pagination. Deduplicate after every observation and stop at the configured number of unique job IDs rather than assuming each page contains a fixed number of cards.

## Detail collection

Open only `FORWARD` and configured `MANUAL_REVIEW` jobs. Use `extractJobDetailsInParallel` from `scripts/linkedin_split_pane_adapter.mjs` as the primary detail path. It opens canonical `/jobs/view/<discovered-id>/` pages in independent tabs, with a default and hard maximum concurrency of 5. Never use an ID that was not collected from a visible result card.

For each direct-detail tab:

1. Verify the canonical URL contains the discovered job ID and the expected title is visible.
2. Accept `About the job`, `Über den Job`, or `Infos zur Stelle` as the description heading.
3. When the description is not initially visible, scroll once to trigger lazy rendering.
4. Use bounded condition checks after 500 ms, 1 second, and 2 seconds rather than one immediate fixed-time decision.
5. Extract and checkpoint the result as soon as that job settles; do not wait for the full parallel batch before persisting it.
6. Close the job's temporary tab after its checkpoint callback completes.

Use `Promise.allSettled` semantics so one failed job does not discard other results. Reject configurations above concurrency 5. Stop assigning new jobs when any worker detects login expiry or an access challenge.

Use `navigateAndExtractSplitPane` as the first per-job fallback: add the discovered job ID to the original search URL as `currentJobId`, navigate, and verify the expected title plus the visible description heading. Use `selectAndExtractSplitPane` as the second fallback: return to the search page, verify the captured card identity, and click a unique accessible title or job-ID link.

Treat selection verification as mandatory. If the exact link is absent or non-unique, record a warning and do not guess by card position. After the two bounded same-page fallbacks fail, record `retrieval_failed`; do not loop back into repeated direct-page attempts.

For a direct `/jobs/view/<id>/` page, use staged rendering: observe the header, scroll once to the description region, then verify a supported description heading. When it is still absent, use only the bounded 500 ms, 1 second, and 2 second condition checks. Record `retrieval_failed` after that schedule; do not loop until the description appears.

Record incomplete text, collapsed sections, external redirects, missing company, and missing location as warnings. Do not treat an incomplete extraction as a hard-gate failure.

Persist each detail attempt immediately, keyed by LinkedIn job ID. For a failed attempt, preserve the discovered card, captured source URL, canonical job URL, extraction warnings, and any partial description. A batch controller must resume from this checkpoint and skip already retrieved IDs. Do not keep the only copy of completed descriptions or failed-job review links in an in-memory loop that can fail on a later navigation.

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
