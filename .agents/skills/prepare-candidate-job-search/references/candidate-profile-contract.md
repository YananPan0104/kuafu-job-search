# Candidate Profile Contract

## Ownership and storage

`prepare-candidate-job-search` owns creation and revision of the candidate profile. Store one canonical, versioned `candidate-profile.json` in the candidate workspace and pass its path explicitly to discovery and tailoring. Downstream skills may read and validate it but must not silently rebuild or overwrite it.

Preserve the original CV and every supplemental source unchanged. Use portable source references relative to the candidate workspace when possible.

## CV onboarding

Accept DOCX or PDF baseline CVs plus optional supporting files and explicit candidate statements. Use the Documents skill for DOCX extraction and visual inspection, and the PDF skill for PDF extraction and page verification.

Create atomic facts. Each fact requires:

- `id`, `category`, `value`, `status`, and `sources`;
- a source reference containing the artifact and a page, section, paragraph, table cell, or other stable locator;
- one of `verified`, `source_claimed`, `needs_confirmation`, or `expired`.

Use `source_claimed` for an uncorroborated CV statement. Reserve `verified` for facts corroborated by another supplied source or explicitly confirmed by the candidate. Do not infer work authorization, willingness to relocate, language level, seniority preference, metrics, ownership, or tool proficiency.

Record incompatible source statements in `conflicts`. Record plausible but unsupported statements in `unverified_claims`; do not promote them into facts.

## Downstream integrity

Validate the profile before use and compute its canonical SHA-256 fingerprint. Store that fingerprint in newly generated job-search policies and propagate it into query and screening provenance. If candidate ID, `as_of`, or fingerprint differs, stop and require regeneration from the canonical profile.

When the source CV changes, create a new profile revision, re-evaluate affected facts, and regenerate dependent policies and query portfolios. Do not mutate historical run artifacts.
