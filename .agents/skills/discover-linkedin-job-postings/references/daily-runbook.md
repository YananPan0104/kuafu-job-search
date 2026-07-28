# Daily Discovery Runbook

Use this runbook for the conversational daily MVP and for explicitly requested recovery runs. Scheduling remains an orchestration concern; this skill executes a supplied trigger and does not create or monitor schedules.

## Normal daily run

1. Accept a stable, date-based run ID and confirm that no other daily run for the candidate is active.
2. Load the canonical candidate profile, candidate confirmation ledger, confirmed search policy, and active portfolio for the `daily` run profile.
3. Run `validate_discovery_inputs.py` with the ledger when the policy references it. Stop before browser work when candidate identity, source versions, ledger fingerprint or links, policy state, open confirmations, or run-profile references do not validate.
4. Confirm that LinkedIn is signed in through the user-visible Codex in-app browser.
5. Execute active queries only. The daily profile must use `Past 24 hours`, recent-first ordering, and the configured per-query collection limit.
6. Verify visible filters once per query. Record URL-to-UI filter corrections as fallbacks.
7. Collect visible cards, deduplicate by LinkedIn job ID, merge query provenance, and stop at the configured number of unique jobs.
8. Apply first-level triage. Preserve all `SKIP_FIRST_LEVEL` records and open details only for `FORWARD` and configured `MANUAL_REVIEW` jobs.
9. Extract discovered job IDs through canonical direct-detail tabs with `extractJobDetailsInParallel`; never exceed concurrency 5. Checkpoint every settled attempt immediately. Use `currentJobId` navigation and exact-card selection only as bounded fallbacks.
10. Materialize and validate the run artifacts, including empty failed-job review files when there are no failures.
11. Hand every validated `retrieved` or `cached` JobPosting directly to detailed screening. Continue automatically for downstream `PASS` outputs; pause only for unresolved `HOLD` facts or an operational stop.
12. Report query counts, discovered cards, first-level skips, details opened, retrieved JDs, cache hits, retrieval failures, filter fallbacks, screening outcomes, generated documents, warnings, and incomplete stages.

## Stop and resume conditions

Stop assigning new browser work when LinkedIn login expires, a CAPTCHA or access challenge appears, or the page structure changes materially. Do not treat an empty or partially loaded pane as a confirmed zero-result run.

After the user restores browser access, resume the same run ID from its checkpoints. Skip already retrieved job IDs and retain every failed-job review link. Do not restart completed work or silently switch the run profile.

## Recovery run

Use recovery only when a daily run was missed or materially failed. Require an explicit bounded recovery window such as `Past 48 hours` or `Past week`; do not assume that the next strict `Past 24 hours` run covers the gap.

Keep recovery separate from the active daily default. Preserve the same first-level rules, extraction limits, job-ID and content-hash deduplication, artifact validation, and downstream handoff behavior. Record the recovery profile and trigger in the run manifest.

## Operating constraints

- Run only one daily or recovery execution for a candidate at a time.
- Keep query and collection limits explicit.
- Never call private LinkedIn APIs, enumerate unknown job IDs, bypass a challenge, save jobs, create alerts, or submit applications.
- Treat `failed-jobs.md` as the manual-review queue, not as permission to retry indefinitely.
- A normal zero-result run, partial failure, operational stop, and completed run must be distinguishable in the final summary.
