# Discovery Data Contracts

## Query portfolio

Require `schema_version`, `candidate_id`, `as_of`, and `queries`.

Each query requires:

- `query_id`: stable identifier;
- `purpose`: human-readable search hypothesis;
- `statement`: LinkedIn Boolean statement;
- `status`: `draft`, `active`, or `retired`;
- `filters`: location, date posted, employment types, experience levels, and sort order;
- `rationale`: why the query exists;
- `known_noise`: expected false-positive families.

Scheduled and event-triggered runs may execute only `active` queries.

Generated portfolios also require `source_profile_as_of` and `source_policy_version`. In a confirmed policy, an `approved` target compiles to an `active` query because target approval covers the deterministic Boolean statement. Proposed targets and all targets in a draft policy compile to `draft`. Changing a target's must-groups, exclusions, or filter overrides requires returning it to `proposed` before regeneration.

When the policy defines run profiles, record `run_profile` and `collection_limit` in the portfolio. A daily profile should normally use `Past 24 hours` with recent-first ordering. Keep broader test windows in a distinct capability-test profile so scheduled runs do not repeatedly scan the same week of results.

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
- `jobs`
- `metrics`
- `warnings`

Each job requires:

- `job_id`
- `title`
- `company`
- `canonical_url`
- `query_ids`
- `first_level_decision`
- `reason_codes`
- `collection_status`

For `retrieval_failed`, schema 1.1 manifests additionally require:

- `manual_review_required` equal to `true`;
- `review_url`, using the stable canonical LinkedIn job URL;
- non-empty `retrieval_warnings`.

Valid collection statuses are `not_requested`, `skipped_before_detail`, `retrieved`, `cached`, and `retrieval_failed`.

For `retrieved` and `cached`, require `jobposting_json` and `jobposting_markdown` paths relative to the run directory.

Metrics require `cards_discovered`, `details_skipped`, `details_retrieved`, `cache_hits`, and `retrieval_failed`. Counts must match job records.

Schema 1.1 manifests require `failed_jobs_review` with relative paths to `failed-jobs.json` and `failed-jobs.md`, plus a count matching `metrics.retrieval_failed`. The JSON review queue preserves job ID, title, company, location, canonical URL, captured source URL, query provenance, failure codes, and any partial description. The Markdown queue provides a directly clickable canonical LinkedIn link for every failed job. Schema 1.0 manifests remain valid for historical compatibility.

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
