# Data Schemas

## Candidate profile

Require `schema_version`, `candidate_id`, `as_of`, `facts`, `conflicts`, and `unverified_claims`. Each fact requires `id`, `category`, `value`, `status`, and `sources`. Valid statuses are `verified`, `source_claimed`, `needs_confirmation`, and `expired`.

Use the canonical profile produced by `prepare-candidate-job-search`. Preserve its candidate ID, version or `as_of` value, fingerprint, evidence sources, conflicts, and unverified claims. Do not silently replace or rebuild it. A provenance mismatch returns to profile revision.

## Candidate confirmations and policy

Load the candidate-local `candidate-confirmations.json` and confirmed `job-search-policy.json` when a candidate statement or preference affects screening. Require matching candidate IDs and the ledger fingerprint recorded by the policy. Use active ledger entries only.

Search preferences are not screening gates by default. A candidate-side screening requirement must use `hardness_basis: candidate_policy` and add `policy_evidence` containing `policy_confirmation_id`, `ledger_confirmation_id`, and `screening_gate_id`. The policy item must be resolved, the policy gate active, the ledger entry active, and its scope must include both the policy confirmation ID and screening gate ID.

## Discovery JobPosting input

Accept a selected artifact from a validated `discover-linkedin-job-postings` run. Require schema.org `JobPosting` fields `@context`, `@type`, `title`, `hiringOrganization.name`, `description`, and `url`.

Record the discovery `run_id`, `job_id`, `query_ids`, canonical URL, collection status, extraction warnings, and relative artifact path in `source-audit.md`. Accept only `retrieved` or `cached` jobs for detailed screening. A `SKIP_FIRST_LEVEL` discovery decision is not a final application gate and may be overridden by selecting the artifact for review.

## Screening report

Require `schema_version`, `case_id`, `gate`, `underlying_gate`, `recommendation`, `requirements`, `blocking_questions`, and `override`.

Each requirement requires `id`, `criterion`, `classification`, `hardness_basis`, `candidate_status`, `jd_evidence`, `candidate_evidence`, `confidence`, `reasoning`, and `follow_up_question`. A `candidate_policy` requirement additionally requires `policy_evidence`.

When the normalized JD body is classified as German, also require top-level `reason_codes` containing `JD_LANGUAGE_GERMAN` and `jd_language_detection` containing `detector_version`, `language`, `word_count`, German and English marker counts, German marker ratio, and evidence terms. The report must include a hard unmet `JD language is German` requirement with `hardness_basis: user_override`; both `gate` and `underlying_gate` must be `FAIL`, with no application-generation next action.

If explicit user authorization waives this rule for this job, retain those language findings and detector fields with `underlying_gate: FAIL`, but set effective `gate: OVERRIDDEN` and record scoped override provenance. Continue other screening and preserve any additional unwaived hard blockers. This exception takes precedence over the default no-generation language rule above.

For batch materialization of a German-language JD override, `override` must be an object containing the matching string `job_id`, `requirement_ids` listing every unfulfilled hard requirement explicitly waived by the user, nonempty `user_answer`, and `user_message_locator`. The materializer rejects a generic truthy override, another job's authorization, missing provenance, or unwaived hard blockers. Metadata shape does not prove genuine authorization; the agent must record the actual scoped user instruction.

Valid classifications are `hard`, `soft`, and `learnable`. Valid candidate statuses are `met`, `partial`, `unmet`, and `unknown`.

## Screening-only batch

For several retrieved discovery jobs, require a batch ID, candidate ID, candidate profile `as_of`, source discovery run ID, per-job screening-report path, gate counts, `mode: screen_and_advance`, application-generation policy, and per-job next action. Keep normalized JD and source-audit references adjacent to each job report. Automatically advance `PASS` and `OVERRIDDEN`; do not create application cases for `FAIL`, unresolved `HOLD`, or unselected jobs.

## Change proposal

For every substantive edit record `section`, `original`, `proposed`, `reason`, `evidence`, and `risk`. Never use a generated proposal as evidence for a later case.

For key-experience deletion, omission, or material compression (including in initial drafting), new facts, ambiguous claims/metrics, or evidence conflicts, also link the finding ID and scoped user approval before changing content. Apparent JD irrelevance is a rationale to propose a key omission, not authorization to apply it.

## Draft review and resolution

Follow [Draft Content Review](draft-content-review.md) for the handoff, independent report, and resolution field contracts. Keep the reviewed draft configuration and readable draft immutable; store revised content separately. Handoff source fingerprints bind the full JD, baseline, canonical evidence, and reviewed revision. Record actual model/reasoning where available, rather than assuming configured defaults were used.

`work/review-resolution.json` records every finding and its disposition, scoped approval provenance when required, reviewed and resulting configuration fingerprints, source fingerprints, and `status: ready_for_generation` or `pending_user_input`. Pending findings prevent final generation. A rejected suggestion preserves supported original content but cannot dismiss an unresolved factual defect. These records are workflow artifacts; the legacy builder does not programmatically enforce them.

## Case configuration

Require `schema_version`, `case`, `candidate`, `cv`, and `cover_letter`.

Use this same builder-compatible structure in `work/case-config.draft.json` before review. Preserve the reviewed draft and store revised configuration/readable text separately until content resolution is complete; only then write final `work/case-config.json`. Keep `work/application-draft.md` complete and consistent with the reviewed configuration. Include cover-letter text in review only when requested; follow the builder's selected-document mode for CV-only generation.

- `case` requires `case_id`, verified `employer`, `role_title`, `location`, and `application_date`.
- `candidate` requires `slug`, `name`, `location`, `phone`, `email`, and `work_authorization`.
- `cv` requires `output_filename`, `headline`, `summary`, `experience`, `education`, `skills`, `certifications`, and `languages`.
- `cover_letter` requires `output_filename`, `recipient_lines`, `subject`, `salutation`, `paragraphs`, and `closing`.

Treat this file as case data. Reusable scripts must read it through parameters and must not embed applicant identities, contact details, employers, roles, dates, case slugs, or absolute user paths.
