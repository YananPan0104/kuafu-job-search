---
name: prepare-candidate-job-search
description: Build and validate an evidence-linked candidate profile from raw CVs and supporting evidence, then create a reviewable job-search policy with explicit preference questions and evidence-linked search targets. Use when onboarding a candidate from DOCX or PDF, revising a candidate fact base, separating facts from search preferences, preparing inputs for discover-linkedin-job-postings, or validating profile and policy provenance.
---

# Prepare Candidate Job Search

Create the canonical candidate fact base and candidate-specific search policy without embedding candidate data in reusable skill code.

## Inputs

Accept either raw DOCX/PDF CV evidence for onboarding or an existing canonical `candidate-profile.json`. Accept optional supplemental evidence and explicit candidate statements.

Read `references/candidate-profile-contract.md` before creating or revising a profile. Read `references/policy-contract.md` before proposing preferences or search targets.

## Workflow

1. When raw CV evidence is supplied, use the Documents or PDF skill to extract text and visually verify every page. Preserve the source files unchanged.
2. Build atomic facts with stable evidence locators. Mark uncorroborated CV statements `source_claimed`, conflicts explicitly, and unsupported assertions as unverified. Do not infer preferences or favorable facts.
3. Store one canonical, versioned `candidate-profile.json` in the candidate workspace. Downstream skills receive this path and may not silently rebuild the profile.
4. Run `scripts/candidate_search_policy.py validate-profile --profile <candidate-profile.json>` and preserve the returned fingerprint in downstream provenance.
5. Run `scripts/candidate_search_policy.py draft --profile <candidate-profile.json> --output <job-search-policy.json>` to create an evidence index and unresolved preference controls.
6. Review profile facts, conflicts, expired facts, and unverified claims. Populate `proposed_preferences` as proposals, not facts.
7. Add `search_targets` using role and keyword groups supported by `evidence_fact_ids` or explicit resolved confirmation IDs. Record rationale and known noise.
8. Ask the user only for open choices that materially affect search results. Keep the policy `draft` while any required confirmation remains open; confirm it only after search scope approval and at least one target exists.
9. Run `scripts/candidate_search_policy.py validate --profile <candidate-profile.json> --policy <job-search-policy.json>`.
10. Hand the confirmed policy and the exact same canonical profile to `discover-linkedin-job-postings`. Make the profile independently accessible to `tailor-job-application` through its stable path and provenance fingerprint.

## Boundaries

- Candidate facts describe what is evidenced; policy describes what to search or skip.
- This skill owns profile creation and revision. Discovery and tailoring may validate and read the profile but must not overwrite it.
- Do not infer willingness to relocate, travel, accept a contract, skip a language, or target a seniority level solely from the CV.
- Do not encode LinkedIn Boolean syntax or control the browser. An approved search target authorizes the Collector's deterministic compiled query; proposed targets remain draft.
- Keep names, contact data, profile content, and absolute user paths outside reusable scripts.

## Tools

- `scripts/candidate_search_policy.py validate-profile --profile <profile.json>`: validate candidate facts and emit the canonical profile fingerprint.
- `scripts/candidate_search_policy.py draft --profile <profile.json> --output <policy.json>`: create a candidate-neutral draft policy scaffold.
- `scripts/candidate_search_policy.py validate --profile <profile.json> --policy <policy.json>`: validate schema, evidence references, confirmation state, and candidate identity.
