# Candidate Job-Search Policy Contract

## Separation rule

Store evidence-linked facts only in `candidate-profile.json`. Store search choices and reversible heuristics only in `job-search-policy.json`.

## Policy fields

Require:

- `schema_version`, `policy_version`, `candidate_id`, `as_of`, and `status`;
- `source_profile` with the profile `candidate_id`, `as_of`, canonical fingerprint, and indexed fact IDs;
- `candidate_signals`, containing references to relevant profile facts rather than copied claims where possible;
- `proposed_preferences` for locations, employment types, experience levels, date window, sort order, and title-language behavior;
- `default_filters` in the human-readable vocabulary accepted by the LinkedIn URL builder;
- `search_targets`, initially proposed and evidence-linked;
- `confirmation_items`, with required choices marked `open` or `resolved`.

Valid policy statuses are `draft` and `confirmed`. A confirmed policy requires at least one search target and no required open confirmation.

## Search target

Each target requires:

- `target_id` and `purpose`;
- `must_groups`, an array of `{ "label": string, "terms": string[] }` groups compiled with `AND` between groups and `OR` within each group;
- `exclude_terms`;
- `rationale` and `known_noise`;
- `evidence_fact_ids` and `confirmation_ids`;
- optional filter overrides;
- `status`: `proposed`, `approved`, or `retired`.

A target must cite at least one profile fact or one resolved confirmation. Do not use broad exclusions such as a language name when the term may appear in viable descriptions.
