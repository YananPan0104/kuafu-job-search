# LinkedIn Discovery Enhancement Backlog

Reusable examples below are anonymized; original incident paths and identifiers remain in local runtime records.

Status: Implemented with one live-integration blocker
Recorded: 2026-08-14
Scope: `discover-linkedin-job-postings`
Implementation owner: Future Codex CLI session

## Purpose

This document records two project-level discovery gaps identified during live LinkedIn use. It is intentionally implementation-ready and self-contained so a future Codex CLI session can continue without relying on conversation history.

Do not treat the current LinkedIn discovery skill as production-complete until both items below are implemented and tested. Preserve the existing compliance boundary: use only the authenticated, user-visible LinkedIn interface; do not use private APIs, bypass access controls, enumerate unknown job IDs, or automate application submission.

## Context

The current discovery design was built around traditional LinkedIn Boolean searches and deterministic search URLs. LinkedIn now forces Smart Job Search for the observed account/session, with a natural-language search input and relevance expansion behavior.

During the same live workflow, a previously collected Example Employer `Junior BI Analyst` posting (`LinkedIn job ID 1234567890`) was found to end in `… more`. The stored Markdown, JobPosting JSON, and browser checkpoint all contain the same collapsed text. Despite this, the extraction was marked `retrieved`, passed validation, and was handed to screening and document generation.

Relevant historical evidence:

- `discovery/<candidate-id>/runs/2026-08-10-daily-01/jobs/1234567890.md`
- `discovery/<candidate-id>/runs/2026-08-10-daily-01/jobs/1234567890.json`
- `discovery/<candidate-id>/runs/2026-08-10-daily-01/browser-checkpoint.json`
- `discovery/<candidate-id>/runs/2026-08-10-daily-01/screening/1234567890/screening-report.md`
- `cases/gulf-associates-junior-bi-analyst/`

## Enhancement 1: Adapt discovery to mandatory Smart Job Search

### Current gap

The current skill assumes that approved T1-T5 targets are compiled primarily into Boolean query statements and deterministic LinkedIn search URLs. That no longer represents the observed LinkedIn UI. Smart Job Search accepts natural-language intent, interprets conditions, and may broaden results beyond exact matches.

LinkedIn displays a semantic boundary in the result list:

> We found more results related to your search that may not be exact matches, but could still be a great fit.

Jobs below this boundary are expanded related results, not exact matches to the requested search. They must be excluded from collection for the high-precision daily workflow.

### Required behavior

1. Convert each approved candidate search target T1-T5 into a stable, reviewable natural-language query suitable for Smart Job Search.
2. Keep the structured target and policy as the source of truth. The natural-language prompt is a source-specific compilation artifact, not a replacement for candidate facts or policy.
3. Enter the query through the visible Smart Job Search input and record the exact submitted text.
4. Inspect and record visible interpretation, chips, and filters. Verify `Past 24 hours` for the daily profile and record Smart Search `semantic_relevance` ranking.
5. Collect result cards only until the visible related-results boundary is reached.
6. Do not collect, triage, open, cache, or hand off jobs below that boundary. Record the boundary observation and excluded-card count for auditability when visible.
7. If the boundary cannot be reliably identified because of DOM drift, partial rendering, or localization, stop or mark the query incomplete instead of silently collecting broadened results.
8. Preserve compatibility with a traditional search interface if LinkedIn exposes it again, but make the active execution mode explicit in artifacts.

### Artifact and contract changes

Add or revise fields covering at least:

- search mode, such as `smart_natural_language` or `traditional_boolean`;
- structured target ID and source policy version;
- submitted natural-language query;
- visible Smart Search interpretation or filters;
- exact-match boundary status and recognized marker text;
- cards observed above and below the boundary;
- query stop reason, including `related_results_boundary_reached`;
- warnings for missing or ambiguous boundary detection.

Update the query portfolio contract without discarding T1-T5 provenance or approval state. Scheduled and manual daily runs must remain reproducible and must not silently rewrite approved target intent.

### Acceptance criteria

- All active T1-T5 targets have reviewed natural-language Smart Search representations.
- A test fixture containing the boundary marker returns only cards above it.
- Cards below the boundary never enter first-level triage or JD extraction.
- The run manifest records the submitted query, execution mode, boundary state, counts, and stop reason.
- Missing or ambiguous boundary detection produces an explicit incomplete/blocked outcome.
- Visible daily filters are still verified rather than inferred from the submitted prompt.

## Enhancement 2: Expand collapsed JD text before extraction

### Current gap

`extractSelectedJobDetail` in `linkedin_split_pane_adapter.mjs` currently locates the supported description heading and directly reads the containing section's `innerText`. It does not locate or click a `more` control.

The current completeness checks are insufficient:

- a non-empty description with a matching title is marked `retrieved`;
- only descriptions shorter than 300 characters receive `DESCRIPTION_MAY_BE_INCOMPLETE`;
- `validate_discovery_run.py` checks that the description is non-empty but does not reject collapsed-text markers.

Consequently, a long but truncated JD ending in `… more` can pass extraction and validation.

### Required behavior

1. Detect visible collapsed-description controls and terminal markers, including reasonable English and German variants such as `… more`, `Show more`, `See more`, and `Mehr anzeigen`.
2. Scope the click to the job-description section. Do not click unrelated page-level `more` controls.
3. Click the unique visible expansion control through the user-visible interface.
4. Wait with the existing bounded condition-check policy for the description to expand or change.
5. Re-read the description only after expansion settles.
6. Confirm that no collapsed marker or expansion control remains in the extracted description section.
7. If expansion cannot be verified, preserve the partial text and mark the result `incomplete_description` or `retrieval_failed`; do not hand it to detailed screening as a validated complete JD.
8. Record expansion attempt, control identity, outcome, wait duration, and warnings in the checkpoint and run manifest.
9. Detect historical retrieved artifacts that retain collapsed markers and place them in a refresh/manual-review queue.

### Validation changes

The validator must reject a supposedly complete retrieved JD when:

- its normalized description ends with a known collapsed marker;
- the extraction metadata reports an unexpanded description;
- an expansion attempt failed or remained ambiguous.

Avoid relying only on a minimum character count. Length can be a supporting heuristic, but it cannot prove completeness.

### Acceptance criteria

- DOM fixtures cover collapsed and already-expanded English and German descriptions.
- The adapter clicks only the description-specific expansion control.
- The extracted text is re-read after expansion and excludes UI labels.
- A long description ending in `… more` cannot be marked `retrieved` without an explicit verified expansion state.
- Failed expansion retains partial text and source URLs but blocks downstream screening handoff.
- The Example Employer artifact is detected as incomplete by the new validation or migration audit.

## Likely implementation locations

Review at least:

- `.agents/skills/discover-linkedin-job-postings/SKILL.md`
- `.agents/skills/discover-linkedin-job-postings/references/linkedin-browser-workflow.md`
- `.agents/skills/discover-linkedin-job-postings/references/data-contracts.md`
- `.agents/skills/discover-linkedin-job-postings/scripts/linkedin_split_pane_adapter.mjs`
- `.agents/skills/discover-linkedin-job-postings/scripts/materialize_browser_checkpoint.py`
- `.agents/skills/discover-linkedin-job-postings/scripts/validate_discovery_run.py`
- `skill-src/discover-linkedin-job-postings/` as the canonical reusable source
- relevant JavaScript and Python tests under the discovery skill and project test runner

Keep `skill-src/discover-linkedin-job-postings/` and the active `.agents/skills/discover-linkedin-job-postings/` installation synchronized according to the repository's established workflow. Run `scripts/test.ps1` before committing changes to skill scripts.

## Suggested implementation sequence

1. Add fixtures that reproduce Smart Search result boundaries and collapsed JD descriptions.
2. Update data contracts and checkpoint/run-manifest schemas.
3. Implement Smart Search natural-language execution and boundary-aware card collection.
4. Implement description-scoped expansion and post-expansion completeness checks.
5. Strengthen materialization and validation so incomplete artifacts cannot be handed downstream.
6. Add a migration/audit utility for historical JDs containing collapsed markers.
7. Run deterministic tests and a bounded authenticated browser integration test across T1-T5.
8. Re-collect or quarantine affected historical JDs, starting with LinkedIn job ID `1234567890`.

## Definition of done

Both enhancements are complete only when the reusable documentation, canonical skill source, active installation, data contracts, implementation, fixtures, tests, and historical-artifact handling agree. A successful browser demonstration must show that Smart Search stops at the related-results boundary and that a collapsed JD is expanded and verified before downstream handoff.

## 2026-08-16 implementation evidence

- Smart-only positive-intent compilation implemented; obsolete Boolean execution removed.
- T1-T5 authenticated smoke searches completed using the `role_context` variants.
- Visible `Past 24 hours` filter verified.
- Related-results boundary observed on T5 page 2 and captured in the smoke artifact.
- Smart card IDs verified in `componentkey=job-card-component-ref-<digits>`.
- Collapsed descriptions are blocked by adapter, materializer, cache validation, and run validation.
- Historical audit identified 230 affected artifact instances and includes `1234567890`.
- Canonical and active discovery skills are synchronized; the complete deterministic suite passes.

Resolved follow-up: the obsolete `Most recent` requirement was removed because Smart Search exposes semantic relevance rather than a selectable sort control. Daily runs verify `Past 24 hours`, record `semantic_relevance`, and still stop at the exact-match boundary.
