# Data Schemas

## Candidate profile

Require `schema_version`, `candidate_id`, `as_of`, `facts`, `conflicts`, and `unverified_claims`. Each fact requires `id`, `category`, `value`, `status`, and `sources`. Valid statuses are `verified`, `source_claimed`, `needs_confirmation`, and `expired`.

Use the canonical profile produced by `prepare-candidate-job-search`. Preserve its candidate ID, version or `as_of` value, fingerprint, evidence sources, conflicts, and unverified claims. Do not silently replace or rebuild it. A provenance mismatch returns to profile revision.

## Discovery JobPosting input

Accept a selected artifact from a validated `discover-linkedin-job-postings` run. Require schema.org `JobPosting` fields `@context`, `@type`, `title`, `hiringOrganization.name`, `description`, and `url`.

Record the discovery `run_id`, `job_id`, `query_ids`, canonical URL, collection status, extraction warnings, and relative artifact path in `source-audit.md`. Accept only `retrieved` or `cached` jobs for detailed screening. A `SKIP_FIRST_LEVEL` discovery decision is not a final application gate and may be overridden by selecting the artifact for review.

## Screening report

Require `schema_version`, `case_id`, `gate`, `underlying_gate`, `recommendation`, `requirements`, `blocking_questions`, and `override`.

Each requirement requires `id`, `criterion`, `classification`, `hardness_basis`, `candidate_status`, `jd_evidence`, `candidate_evidence`, `confidence`, `reasoning`, and `follow_up_question`.

Valid classifications are `hard`, `soft`, and `learnable`. Valid candidate statuses are `met`, `partial`, `unmet`, and `unknown`.

## Screening-only batch

For several retrieved discovery jobs, require a batch ID, candidate ID, candidate profile `as_of`, source discovery run ID, per-job screening-report path, gate counts, `mode: screen_and_advance`, application-generation policy, and per-job next action. Keep normalized JD and source-audit references adjacent to each job report. Automatically advance `PASS` and `OVERRIDDEN`; do not create application cases for `FAIL`, unresolved `HOLD`, or unselected jobs.

## Change proposal

For every substantive edit record `section`, `original`, `proposed`, `reason`, `evidence`, and `risk`. Never use a generated proposal as evidence for a later case.

## Case configuration

Require `schema_version`, `case`, `candidate`, `cv`, and `cover_letter`.

- `case` requires `case_id`, verified `employer`, `role_title`, `location`, and `application_date`.
- `candidate` requires `slug`, `name`, `location`, `phone`, `email`, and `work_authorization`.
- `cv` requires `output_filename`, `headline`, `summary`, `experience`, `education`, `skills`, `certifications`, and `languages`.
- `cover_letter` requires `output_filename`, `recipient_lines`, `subject`, `salutation`, `paragraphs`, and `closing`.

Treat this file as case data. Reusable scripts must read it through parameters and must not embed applicant identities, contact details, employers, roles, dates, case slugs, or absolute user paths.
