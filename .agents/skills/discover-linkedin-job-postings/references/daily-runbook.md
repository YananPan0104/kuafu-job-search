# Daily Discovery Runbook

Use this runbook for the conversational daily MVP and for explicitly requested recovery runs. Scheduling remains an orchestration concern; this skill executes a supplied trigger and does not create or monitor schedules.

## Normal daily run

1. Accept a stable, date-based run ID and confirm that no other daily run for the candidate is active.
2. Load the canonical candidate profile, candidate confirmation ledger, confirmed search policy, and active portfolio for the `daily` run profile.
3. Run `validate_discovery_inputs.py` with the ledger when the policy references it. Stop before browser work when candidate identity, source versions, ledger fingerprint or links, policy state, open confirmations, or run-profile references do not validate.
4. Confirm that LinkedIn is signed in through the user-visible Codex in-app browser.
5. Execute every active portfolio query. The daily profile must visibly verify `Past 24 hours` and record `semantic_relevance` ranking. Do not set a fixed 30-job limit or another arbitrary per-query/global result-count cap.
6. After the portfolio queries, execute the independent `Jobs where you’d be a top applicant` source from the Jobs landing page. Select the visible `Past 24 hours` radio, activate `Show results`, and verify the visible state; URL `f_TPR=r86400` is corroborating evidence only.
7. For the Top Applicant source, collect every card on page 1 and page 2 only, then stop even if `Next` remains enabled. If page 2 does not exist, record natural exhaustion. This is the only page-count exception and never changes the no-cap rule for normal Smart Search queries.
8. Verify visible filters once per source/query. Record URL-to-UI filter corrections as fallbacks.
9. Collect visible cards, deduplicate by LinkedIn job ID across every source, merge query/source provenance, and for normal Smart queries continue through every exact-match result until the visible related-results boundary or genuine result exhaustion.
10. Apply first-level triage. Preserve all `SKIP_FIRST_LEVEL` records and open details only for `FORWARD` and configured `MANUAL_REVIEW` jobs.
11. Extract discovered job IDs through canonical direct-detail tabs with `extractJobDetailsInParallel`; never exceed concurrency 5. Checkpoint every settled attempt immediately. Use `currentJobId` navigation and exact-card selection only as bounded fallbacks.
12. After checkpointing any transient detail failure, add it to the same run's retry queue. Wait one minute, retry each failed job, and continue at one-minute intervals until it is retrieved or cached. Do not mark the run complete while a retryable failure remains.
13. If login expiry, MFA, CAPTCHA, access challenge, material DOM drift, profile lock, or browser disconnection occurs, preserve the retry queue and stop safely. Resume the same run from its checkpoints after the user restores access; never bypass the stop condition.
14. Materialize and validate the run artifacts, including empty failed-job review files when there are no failures.
15. Hand every validated `retrieved` or `cached` JobPosting directly to detailed screening. Continue automatically for downstream `PASS` outputs; pause only for unresolved `HOLD` facts or an operational stop.
16. Report portfolio-query and Top Applicant source counts separately, discovered cards, first-level skips, details opened, retrieved JDs, cache hits, retry attempts, remaining retrieval failures, filter fallbacks, screening outcomes, generated documents, warnings, and incomplete stages.

## Stop and resume conditions

Stop assigning new browser work when LinkedIn login expires, a CAPTCHA or access challenge appears, or the page structure changes materially. Do not treat an empty or partially loaded pane as a confirmed zero-result run.

After the user restores browser access, resume the same run ID from its checkpoints. Skip already retrieved job IDs and retain every failed-job review link. Do not restart completed work or silently switch the run profile.

## Recovery run

Use recovery only when a daily run was missed or materially failed. Require an explicit bounded recovery window such as `Past 48 hours` or `Past week`; do not assume that the next strict `Past 24 hours` run covers the gap.

Keep recovery separate from the active daily default. Preserve the same first-level rules, one-minute failed-detail retry behavior, job-ID and content-hash deduplication, artifact validation, and downstream handoff behavior. Record the recovery profile and trigger in the run manifest.

## Operating constraints

- Run only one daily or recovery execution for a candidate at a time.
- Do not use a fixed 30-job cap or another arbitrary result-count/page-count cap for normal Smart Search queries. The approved queries, visible related-results boundary, exhaustion, and safety stops define their completion. The Top Applicant source alone stops after its first two result pages.
- Never call private LinkedIn APIs, enumerate unknown job IDs, bypass a challenge, save jobs, create alerts, or submit applications.
- Treat `failed-jobs.md` as the durable retry and manual-review queue. Retry transient failures automatically every minute until success; preserve the queue and stop instead when a mandatory safety condition is present.
- A normal zero-result run, partial failure, operational stop, and completed run must be distinguishable in the final summary.
