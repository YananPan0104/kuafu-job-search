---
name: prepare-candidate-job-search
description: Build and validate an evidence-linked candidate profile from raw CVs and supporting evidence, then create a reviewable job-search policy with explicit preference questions and evidence-linked search targets. Use when onboarding a candidate from DOCX or PDF, revising a candidate fact base, separating facts from search preferences, preparing inputs for discover-linkedin-job-postings, or validating profile and policy provenance.
---

# Prepare Candidate Job Search

Create the canonical candidate fact base and candidate-specific search policy without embedding candidate data in reusable skill code.

## Inputs

Accept either raw DOCX/PDF CV evidence for onboarding or an existing canonical `candidate-profile.json`. Accept optional supplemental evidence and explicit candidate statements.

Read `references/candidate-profile-contract.md` before creating or revising a profile. Read `references/confirmation-ledger-contract.md` before recording or migrating a candidate statement. Read `references/policy-contract.md` before proposing preferences or search targets.

## Workflow

1. When raw CV evidence is supplied, use the Documents or PDF skill to extract text and visually verify every page. Preserve the source files unchanged.
2. Build atomic facts with stable evidence locators. Mark uncorroborated CV statements `source_claimed`, conflicts explicitly, and unsupported assertions as unverified. Do not infer preferences or favorable facts.
3. Store one canonical, versioned `candidate-profile.json` and one candidate-local `candidate-confirmations.json` in the candidate workspace. Conversation is an intake channel; persist every relied-upon candidate answer in the ledger. Downstream skills may validate and reference these artifacts but may not silently rebuild them.
4. For legacy candidates, run `scripts/candidate_confirmations.py migrate` and migrate only explicit candidate-confirmation sources and resolved policy answers. Do not promote all verified facts or convert search preferences into screening gates.
5. Run `scripts/candidate_search_policy.py validate-profile --profile <candidate-profile.json>` and `scripts/candidate_confirmations.py validate` and preserve both fingerprints in downstream provenance.
6. Run `scripts/candidate_search_policy.py draft --profile <candidate-profile.json> --output <job-search-policy.json>` to create an evidence index and unresolved preference controls.
7. Review profile facts, conflicts, expired facts, and unverified claims. Populate `proposed_preferences` as proposals, not facts.
8. Add `search_targets` using role and keyword groups supported by `evidence_fact_ids` or explicit resolved confirmation IDs. Record rationale and known noise.
9. Ask the user only for open choices that materially affect search results. Write each answer to the ledger, link the policy item to its ledger ID, and keep the policy `draft` while any required confirmation remains open. Confirm it only after search scope approval and at least one target exists.
10. Run `scripts/candidate_search_policy.py validate --profile <candidate-profile.json> --policy <job-search-policy.json> --confirmations <candidate-confirmations.json>`.
11. Hand the confirmed policy, ledger, and exact same canonical profile to discovery and tailoring with their provenance fingerprints.

## Boundaries

- Candidate facts describe what is evidenced; policy describes what to search or skip.
- The confirmation ledger records what the candidate explicitly said and where that answer applies. It does not replace the profile or policy.
- This skill owns profile creation and revision. Discovery and tailoring may validate and read the profile but must not overwrite it.
- Do not infer willingness to relocate, travel, accept a contract, skip a language, or target a seniority level solely from the CV.
- Do not encode LinkedIn Boolean syntax or control the browser. An approved search target authorizes the Collector's deterministic compiled query; proposed targets remain draft.
- Keep names, contact data, profile content, and absolute user paths outside reusable scripts.

## Tools

- `scripts/export_candidate_profile_docx.py --profile <candidate-profile.json> --confirmations <candidate-confirmations.json> --output <profile.docx>`: export the complete evidence-linked profile as a reviewable, non-CV DOCX for candidate refinement. The confirmation ledger remains a separate backend provenance artifact unless `--include-confirmation-ledger` is explicitly requested.

- `scripts/candidate_search_policy.py validate-profile --profile <profile.json>`: validate candidate facts and emit the canonical profile fingerprint.
- `scripts/candidate_search_policy.py draft --profile <profile.json> --output <policy.json>`: create a candidate-neutral draft policy scaffold.
- `scripts/candidate_search_policy.py validate --profile <profile.json> --policy <policy.json> [--confirmations <candidate-confirmations.json>]`: validate schema, evidence references, ledger links, screening-gate scopes, confirmation state, and candidate identity.
- `scripts/candidate_confirmations.py migrate --profile <profile.json> [--policy <policy.json>] --output <candidate-confirmations.json> [--output-policy <policy.json>]`: conservatively migrate explicit legacy confirmations and link resolved policy items.
- `scripts/candidate_confirmations.py validate --confirmations <candidate-confirmations.json> [--profile <profile.json>] [--policy <policy.json>]`: validate ledger identity, entries, and scopes.
