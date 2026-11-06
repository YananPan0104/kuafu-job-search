# Discovery Data Contracts

## Query portfolio

Require `schema_version`, `candidate_id`, `as_of`, and `queries`.

Each Smart Search query requires:

- `query_id`: stable identifier;
- `purpose`: human-readable search hypothesis;
- `search_mode`: `smart_natural_language`;
- `ranking_mode`: `semantic_relevance`; Smart Search has no supported `sort_by` field;
- `smart_search.submitted_query`: deterministic positive-intent compilation;
- `smart_search.query_fingerprint` and compiler version;
- `smart_search.excluded_terms_deferred_to_triage`: unsupported Smart Search exclusions retained for first-level filtering;
- `status`: `draft`, `active`, or `retired`;
- `filters`: location, date posted, employment types, experience levels, and sort order;
- `rationale`: why the query exists;
- `known_noise`: expected false-positive families.

Scheduled and event-triggered runs may execute only `active` Smart Search queries. Boolean `statement` execution is obsolete and invalid for an active query.

Generated portfolios also require `source_profile_as_of` and `source_policy_version`. In a confirmed policy, an `approved` target compiles deterministically to an active positive-intent Smart Search query. Proposed targets and all targets in a draft policy compile to `draft`. Changing must-groups, exclusions, filters, or the compiler version requires regeneration and fingerprint review.

When the policy defines run profiles, record `run_profile` and `collection_limit` in the portfolio. A daily Smart Search profile uses `Past 24 hours` with `semantic_relevance` ranking. Keep broader test windows in a distinct capability-test profile.

The Top Applicant discovery source is not a compiled portfolio query. For daily runs, record it independently with `source_mode: linkedin_top_applicant`, `ranking_mode: linkedin_top_applicant_recommendation`, requested and visibly observed `Past 24 hours`, observed page numbers, and supporting URL evidence when available. Its completion reason is `TOP_APPLICANT_TWO_PAGE_LIMIT_REACHED` after page 2 or `EXHAUSTED_RESULTS` when fewer than two pages exist.

## Job-search policy

Keep strategy separate from candidate facts. For title language, read the canonical Skill A field:

```json
{
  "proposed_preferences": {
    "title_language_policy": {
      "de": {
        "enabled": true,
        "mode": "high_precision",
        "action": "skip_detail"
      },
      "unknown": "collect"
    }
  }
}
```

Accept the former top-level `title_language_policy` field only for backward compatibility.

Valid German-title modes are `off`, `high_precision`, and `aggressive`. Never treat `m/w/d` alone as German-language evidence.

For new candidates, consume the policy contract produced by `prepare-candidate-job-search`. Compile each non-retired `search_target.must_groups` with `AND` between groups and `OR` within a group. Treat `exclude_terms` as query-level `NOT` terms. Retain evidence fact IDs and confirmation IDs in generated query records.

Before any active execution, require matching candidate IDs across profile, policy, policy source-profile reference, and query portfolio; matching profile `as_of` and policy versions; a confirmed policy; and no required open confirmations.

## Card batch

The deterministic classifier accepts a JSON array. Each card requires `title`; include `job_id`, `company`, `location`, `canonical_url`, and `query_ids` when available.

Classifier decisions are:

- `FORWARD`
- `MANUAL_REVIEW`
- `SKIP_FIRST_LEVEL`

## Run manifest

Require:

- `schema_version`
- `run_id`
- `candidate_id`
- `source`
- `trigger`
- `started_at`
- `query_portfolio_path`
- `policy_path`
- `filter_verification`
- `query_progress`, keyed by query ID, with status, configured/runtime/effective limits, observations, collected-card count, and an explicit stop reason;
- `jobs`
- `metrics`
- `warnings`
- `stop_reason`, which is `null` for a normally completed extraction or the exact
  batch stop reason recorded by the detail extractor;
- `extraction_stopped`, a boolean indicating whether detail workers stopped early.

Query/source collection stop reasons distinguish `EXHAUSTED_RESULTS`, `TOP_APPLICANT_TWO_PAGE_LIMIT_REACHED`, `QUERY_COLLECTION_LIMIT_REACHED`, `GLOBAL_COLLECTION_LIMIT_REACHED`, `MAX_PAGES_REACHED`, `PAGINATION_NO_PROGRESS`, and operational stops such as `FILTER_STATE_LOST`. Only `EXHAUSTED_RESULTS` means the visible result set was traversed to its end. `TOP_APPLICANT_TWO_PAGE_LIMIT_REACHED` is valid only for `source_mode: linkedin_top_applicant` after pages 1 and 2 were observed.

Each job requires:

- `job_id`
- `title`
- `company`
- `canonical_url`
- `query_ids`
- `source_provenance` when discovered outside or in addition to portfolio queries, including source mode, ranking mode, page number, and filter verification;
- `first_level_decision`
- `reason_codes`
- `collection_status`

For `retrieval_failed`, schema 1.1 manifests additionally require:

- `manual_review_required` equal to `true`;
- `review_url`, using the stable canonical LinkedIn job URL;
- non-empty `retrieval_warnings`.

Valid collection statuses are `not_requested`, `skipped_before_detail`, `retrieved`, `cached`, and `retrieval_failed`. Adapter-level `incomplete_description` materializes as `retrieval_failed`; it is never a handoff status.

For `retrieved` and `cached`, require `jobposting_json` and `jobposting_markdown` paths relative to the run directory.

Metrics require `cards_discovered`, `details_skipped`, `details_retrieved`, `cache_hits`, and `retrieval_failed`. Counts must match job records.

Schema 1.1 and later manifests require `failed_jobs_review` with relative paths to `failed-jobs.json` and `failed-jobs.md`, plus a count matching `metrics.retrieval_failed`. Schema 1.2 additionally requires query-level pagination progress and collection stop reasons. The JSON review queue preserves job ID, title, company, location, canonical URL, captured source URL, query provenance, failure codes, and any partial description. The Markdown queue provides a directly clickable canonical LinkedIn link for every failed job. Schema 1.0 and 1.1 manifests remain valid for historical compatibility.

## JobPosting handoff

Each retrieved JSON artifact must be a schema.org `JobPosting` object with:

- `@context`
- `@type` equal to `JobPosting`
- `title`
- `hiringOrganization.name`
- `description`
- `url`

Add source metadata under a namespaced `discovery` field when required. Do not add candidate matching conclusions to the JobPosting object.

Every `retrieved` or `cached` JobPosting is eligible for automatic downstream detailed screening. Artifact validation is the handoff gate; do not require per-JD human confirmation.
