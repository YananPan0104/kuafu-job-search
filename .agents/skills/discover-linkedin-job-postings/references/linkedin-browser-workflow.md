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

Open only `FORWARD` and configured `MANUAL_REVIEW` jobs. Prefer `navigateAndExtractSplitPane` from `scripts/linkedin_split_pane_adapter.mjs`: add the discovered job ID to the same search URL as `currentJobId`, navigate, and verify the expected title plus the visible `About the job` heading before extraction. This uses LinkedIn's user-visible search-page state and avoids mutable tracking links and pointer-click delays. Never use an ID that was not collected from a visible result card.

Use `selectAndExtractSplitPane` as the first fallback: snapshot the page, verify the captured card identity, click a unique accessible title or job-ID link, take a fresh snapshot, and verify the resulting detail pane. Extract only the selected job header and complete description area rather than repeatedly processing the full page.

Treat selection verification as mandatory. If the exact link is absent or non-unique, record a warning and do not guess by card position. A failed same-page selection may use one bounded direct-page attempt as fallback.

For a direct `/jobs/view/<id>/` page, use staged rendering: observe the header, scroll once to the description region, then verify the visible `About the job` heading. When it is still absent, allow one short delayed-render fallback followed by one fresh verification. Record `retrieval_failed` after that bounded fallback; do not loop until the description appears.

Record incomplete text, collapsed sections, external redirects, missing company, and missing location as warnings. Do not treat an incomplete extraction as a hard-gate failure.

Persist each verified detail immediately after extraction, keyed by LinkedIn job ID. A batch controller must resume from this checkpoint and skip already retrieved IDs. Do not keep the only copy of completed descriptions in an in-memory loop that can fail on a later navigation.

If search-page navigation becomes unavailable after cards have already been collected, one bounded direct `/jobs/view/<discovered-id>/` attempt per remaining card is allowed. Record `DIRECT_PAGE_FALLBACK_USED` and retain the original query provenance. This fallback never authorizes guessing or enumerating job IDs.

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

Do not save, apply, follow companies, create alerts, or change LinkedIn settings.
