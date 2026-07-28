---
name: tailor-job-application
description: Screen job descriptions against a verified candidate fact base, classify hard, soft, and learnable requirements, stop on unresolved hard gates, and prepare auditable ATS CV and cover-letter proposals. Use for job URLs, saved job PDFs, pasted JDs, baseline CVs in DOCX/PDF, candidate memory files, fit assessments, CV tailoring, application change logs, and approved DOCX/PDF generation.
---

# Tailor Job Application

Run an evidence-bound application workflow. Preserve the baseline CV, expose uncertainty, and never turn planned learning or inferred experience into a candidate fact.

## Workflow

For discovery batches, automatically assess every retrieved or cached JobPosting against the canonical candidate profile. Materialize the batch with `scripts/materialize_screening_batch.py`. Do not ask for per-JD confirmation before screening. Automatically advance `PASS` and explicitly `OVERRIDDEN` jobs to CV generation; do not ask for a second approval merely to begin tailoring.

1. Stage and normalize the JD from a discovery JobPosting bundle, URL, PDF, or pasted text. For discovery input, accept every `retrieved` or `cached` artifact without per-JD confirmation and preserve run ID, query provenance, source URL, and extraction warnings.
2. Load the canonical, versioned, evidence-linked `candidate-profile.json`, `candidate-confirmations.json`, and confirmed `job-search-policy.json` produced by `prepare-candidate-job-search`. Validate candidate IDs, evidence statuses, `as_of`, ledger links, and provenance fingerprints. If an artifact is missing, stale, or conflicting, return revision to that skill; do not silently rebuild it here.
3. Build screening artifacts using `references/screening-policy.md` and `references/data-schemas.md`, then run `scripts/validate_case.py`. Use `hardness_basis: candidate_policy` only when the requirement cites both a resolved policy item and its active scoped ledger confirmation.
4. Apply the gate: `PASS` when every hard item is met; `HOLD` when a hard item is partial or unknown; `FAIL` when a hard item is unmet.
5. On `HOLD`, ask only questions that could change the gate. On `FAIL`, stop unless the user explicitly overrides.
6. On `PASS` or explicit override, verify employer and role title from the normalized source, initialize the application case with `scripts/init_case.py`, and preserve the original inputs.
7. Audit the baseline CV for ATS risks. For DOCX, detect text boxes, drawings, tables, images, headers, and extraction-order problems. Visually inspect every page.
8. Automatically create an exact CV change record with original text, proposed text, reason, evidence, and risk. Evidence rules remain mandatory; automatic advancement does not authorize unsupported claims.
9. Keep learnable gaps in `optimization-backlog.json`; never list them as current skills without evidence.
10. Store candidate contact data, verified case metadata, and generated document text in `work/case-config.json`. Missing required case data is an operational blocker, not a new fit-approval gate.
11. Generate the ATS-first CV DOCX with `scripts/build_application_docs.py <case-config.json>`. Use standard headings, real paragraphs/lists, one column, selectable text, and no critical content in text boxes, images, headers, or footers.
12. Use the Documents skill to render and inspect every page. Retry bounded formatting defects and export the CV PDF after visual and extracted-text QA pass. Do not require human confirmation between `PASS` and the completed CV output.
13. Draft a cover letter only when requested, using the generated CV, JD, and verified facts. Keep any separate cover-letter approval policy independent from automatic CV generation.

## Evidence rules

- Preserve the baseline CV and original JD unchanged.
- Preserve discovery run and query provenance when the JD came from `discover-linkedin-job-postings`.
- Preserve confirmation-ledger and policy provenance when a candidate answer or candidate-side gate affects screening.
- Cite every substantive candidate claim to a source artifact and location.
- Flag source conflicts instead of choosing the more favorable version.
- Never invent responsibilities, tools, metrics, credentials, dates, language levels, project ownership, or outcomes.
- Treat generated wording as presentation, not as a fact source.
- Keep private contact data local and out of screening reports unless needed.

## Screening rules

- Classify each criterion as `hard`, `soft`, or `learnable`.
- Record `hardness_basis` as `explicit`, `role_critical_inference`, `candidate_policy`, `user_override`, or `not_applicable`.
- Evaluate status as `met`, `partial`, `unmet`, or `unknown`.
- Show JD evidence, candidate evidence, confidence, reasoning, and targeted questions.
- Never allow a weighted score to override a hard blocker.

## Output contract

Reference the validated canonical `candidate-profile.json`, and maintain `jd-normalized.md`, `source-audit.md`, `screening-report.json`, `screening-report.md`, and `optimization-backlog.json`. For `PASS` or `OVERRIDDEN`, automatically add `case-config.json`, `cv-change-proposal.md`, and final CV files. Add cover-letter files only when that optional path is requested. Store portable relative paths in generated reports whenever possible.

For discovery batches, create `batch-manifest.json` with the source run ID, candidate profile version, per-job gate and next action, aggregate gate counts, `mode: screen_and_advance`, and the automatically eligible application candidates.

Use English for artifacts and filenames. Communicate with the user in their preferred conversation language.

## Tools

- `scripts/audit_docx_ats.py <input.docx>`: detect structural ATS risks.
- `scripts/init_case.py <job-posting.json> --cases-root <cases-dir>`: create a final case only after employer and role verification.
- `scripts/build_application_docs.py <case-config.json>`: render approved CV and cover-letter DOCX files from case data without applicant-specific code.
- `scripts/normalize_job_html.py <input.html> --json <job.json> --markdown <jd.md>`: extract schema.org JobPosting data.
- `scripts/validate_case.py --candidate <candidate-profile.json> --policy <job-search-policy.json> --confirmations <candidate-confirmations.json> --screening <screening-report.json>`: enforce evidence, candidate-policy, and gate consistency.
- `scripts/materialize_screening_batch.py --candidate <profile.json> --policy <job-search-policy.json> --confirmations <candidate-confirmations.json> --manifest <run-manifest.json> --assessments <assessments.json> --output <dir>`: create validated batch screening artifacts and identify `PASS` or `OVERRIDDEN` jobs for automatic CV generation.
- Reuse Browser for interactive/authenticated pages, PDF for PDF inspection, and Documents for DOCX generation and render QA.
