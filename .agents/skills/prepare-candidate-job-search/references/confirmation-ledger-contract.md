# Candidate Confirmation Ledger Contract

## Purpose and ownership

Store durable candidate statements in one candidate-local `candidate-confirmations.json`. Conversation is an intake channel, not the system of record. `prepare-candidate-job-search` owns ledger creation, migration, validation, supersession, and revocation. Downstream skills may validate and reference active entries but must not silently edit them.

Keep the ledger separate from `candidate-profile.json` and `job-search-policy.json`:

- fact confirmations support profile facts;
- preference confirmations support reversible search choices;
- screening-gate confirmations authorize candidate-side hard gates;
- overrides preserve an explicit decision without rewriting the underlying gate.

## Ledger fields

Require `schema_version`, `candidate_id`, `as_of`, and `confirmations`.

Each confirmation requires:

- `id`: stable candidate-local identifier;
- `kind`: `fact`, `preference`, `screening_gate`, or `override`;
- `status`: `active`, `superseded`, or `revoked`;
- `question`: the original question when available, otherwise `null` for migrated legacy facts;
- `answer`: the exact structured or scalar answer;
- `answer_type`: `string`, `boolean`, `number`, `array`, or `object`;
- `recorded_at`;
- `source`: intake or migration provenance with artifact and stable locator;
- `scope`: arrays of `profile_fact_ids`, `policy_confirmation_ids`, and `screening_gate_ids`.

An active confirmation requires a non-null answer. Never delete or overwrite an old answer to represent a changed choice; mark the old entry `superseded` or `revoked` and add a new entry.

## Migration rule

Migrate only evidence that is explicit in existing artifacts:

- profile facts whose source references clearly identify a candidate confirmation, statement, interview, or conversation;
- policy confirmation items whose status is `resolved`.

Do not migrate all `verified` facts, infer an original question, or convert preferences into screening gates. Preserve the original profile and policy locators in the migrated entry.

Adding ledger provenance must not change the canonical candidate profile. If a later confirmation changes a fact value or status, revise the profile through the normal versioned profile workflow and regenerate dependent fingerprints.

## Downstream use

A resolved policy item linked to the ledger must reference an active entry whose scope includes that policy confirmation ID and whose answer matches the policy answer. A screening requirement with `hardness_basis: candidate_policy` must cite the active policy screening gate, its resolved policy item, and the active ledger confirmation scoped to both IDs. Search-only preferences do not become screening gates automatically.
