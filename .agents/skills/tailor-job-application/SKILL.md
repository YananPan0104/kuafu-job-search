---
name: tailor-job-application
description: Screen jobs against verified candidate evidence, tailor CV and optional cover-letter drafts, independently review drafts, and generate checked application documents. Also use to review an existing application draft without editing it. Preserve hard gates, evidence provenance, and approval for sensitive content changes.
---

# Tailor Job Application

Run an evidence-bound application workflow. Preserve the baseline CV, expose uncertainty, and never turn planned learning or inferred experience into a candidate fact.

Use one content owner and one independent, read-only reviewer per job. Read [draft content review](references/draft-content-review.md) before drafting, reviewing, or revising application content. For review-only requests, review the supplied draft and report findings without editing, generating documents, or repeating discovery. Model routing and shared context rules live in the repository `AGENTS.md`; this skill does not require extra agents for each mechanical step.

Screening stop rules, including the German-JD default below, apply unless an explicit user override covers this job and that rule. Preserve detector evidence and the underlying gate; record the effective gate as `OVERRIDDEN` with scoped authorization before continuing. Such overrides do not change candidate facts, authorize sensitive content edits, or relax discovery authentication/access safety stops.

## Workflow

For discovery batches, automatically assess every retrieved or cached JobPosting against the canonical candidate profile. Materialize the batch with `scripts/materialize_screening_batch.py`. Do not ask for per-JD confirmation before screening. Automatically advance `PASS` and explicitly `OVERRIDDEN` jobs to drafting and independent review; no second fit approval is needed. Sensitive content changes still require the scoped approval below. Respect an invoking workflow that explicitly stops after discovery.

1. Stage and normalize the JD from a discovery JobPosting bundle, URL, PDF, or pasted text. For discovery input, accept every `retrieved` or `cached` artifact without per-JD confirmation and preserve run ID, query provenance, source URL, and extraction warnings. Run `scripts/detect_jd_language.py` on the complete normalized description before candidate matching. When it returns `is_german: true`, stop that job's detailed screening, assign a hard unmet `JD language is German` requirement with `hardness_basis: user_override`, set `gate` and `underlying_gate` to `FAIL`, record reason code `JD_LANGUAGE_GERMAN` and the detector evidence, and do not generate application documents. Do not infer the JD language from its title, location, company, or isolated German terms.
2. Load the canonical, versioned, evidence-linked `candidate-profile.json`, `candidate-confirmations.json`, and confirmed `job-search-policy.json` produced by `prepare-candidate-job-search`. Validate candidate IDs, evidence statuses, `as_of`, ledger links, and provenance fingerprints. If an artifact is missing, stale, or conflicting, return revision to that skill; do not silently rebuild it here.
3. Build screening artifacts using `references/screening-policy.md` and `references/data-schemas.md`, then run `scripts/validate_case.py`. Use `hardness_basis: candidate_policy` only when the requirement cites both a resolved policy item and its active scoped ledger confirmation.
4. Apply the gate: `PASS` when every hard item is met; `HOLD` when a hard item is partial or unknown; `FAIL` when a hard item is unmet.
5. On `HOLD`, ask only questions that could change the gate. On `FAIL`, stop unless the user explicitly overrides.
6. On `PASS` or explicit override, verify employer and role title from the normalized source, initialize the application case with `scripts/init_case.py`, and preserve the original inputs.
7. Audit the baseline CV for ATS risks and content before drafting. For DOCX, detect text boxes, drawings, tables, images, headers, and extraction-order problems; extract and review the complete original CV text and visually inspect every page. Reuse an audit and full text extraction only when their source SHA-256, audit method, and recorded page checks still match; inspect again when source content or layout changes. Still read the complete baseline text for this job. Do not rely only on the canonical profile's compressed summaries when the original CV contains relevant, supportable detail.
8. Reconcile the original CV, candidate profile, and confirmation ledger before writing. Build chronology only from verified or source-supported role facts explicitly marked `timeline_role: true`; use `timeline_role: false` experience facts only to enrich, qualify, or constrain those roles. Recover specific responsibilities, tools, methods, business context, deliverables, and outcomes that are supported by the source materials. Record conflicts or genuinely unresolved claims instead of silently choosing the strongest wording.
9. Automatically create an exact CV change record with original text, proposed text, reason, evidence, and risk. Evidence rules remain mandatory; automatic advancement does not authorize unsupported claims.
10. Keep learnable gaps in `optimization-backlog.json`; never list them as current skills without evidence.
11. Store candidate contact data, verified case metadata, and draft document text in `work/case-config.draft.json`; write a complete readable `work/application-draft.md`. Draft a cover letter in this phase only when requested, using the CV draft, JD, and verified facts; emphasize motivation and relevant strengths rather than repeating CV bullets. Preserve any explicit separate cover-letter approval policy. Read verified `document.cv_photo` preferences from the canonical profile; the builder resolves the candidate-relative asset automatically, while `candidate.cv_photo_path` may explicitly override it for a case. Missing required case data is an operational blocker, not a new fit-approval gate.
12. Save `work/review-handoff.json` and obtain independent review of the content draft before generating final documents. Resolve findings according to `references/draft-content-review.md`: apply supported editorial improvements automatically; ask before new facts, ambiguous claims or metrics, evidence conflicts, and deletion, omission, or material compression of key experience, including omissions justified by JD relevance. Keep affected content unchanged pending approval, including during first drafting. Preserve review and revision records; unresolved sensitive changes cannot enter the final configuration.
13. After content resolution, write `work/case-config.json` and generate the ATS-first CV DOCX with `scripts/build_application_docs.py <case-config.json>`. Use standard headings, real paragraphs/lists, one column, selectable text, and no critical content in text boxes, images, headers, or footers. When the verified profile requests a CV photo, use only a simple borderless two-cell identity banner at the top: photo on the left and selectable name/contact text on the right; keep the remainder of the CV one column.
14. Use the Documents skill to render and inspect every final page and verify extracted text, including any requested cover letter. Retry bounded formatting defects and export the PDF only after final visual and text QA pass. Independent content review does not replace file QA. Recheck content only where formatting altered it. Advance automatically except for the scoped content approvals and existing unresolved gates; no blanket human approval is required for final export.

## Evidence rules

- Preserve the baseline CV and original JD unchanged.
- Preserve discovery run and query provenance when the JD came from `discover-linkedin-job-postings`.
- Preserve confirmation-ledger and policy provenance when a candidate answer or candidate-side gate affects screening.
- Cite every substantive candidate claim to a source artifact and location.
- Flag source conflicts instead of choosing the more favorable version.
- Never invent responsibilities, tools, metrics, credentials, dates, language levels, project ownership, or outcomes.
- Treat generated wording as presentation, not as a fact source.
- Keep private contact data local and out of screening reports unless needed.

## Detail-preserving CV tailoring

- Do not impose a one-page target or a default maximum page count. Let relevant, evidence-supported content determine length, with readable typography and coherent page breaks. Apply a page limit only when the user explicitly requests one.
- Preserve substantive detail from the original CV whenever it is relevant and evidence-supported. The canonical profile is an index and validation layer, not a replacement for reviewing the source CV.
- Preserve the detail of JD-relevant experience: project names, system and product names, client names, business context, the candidate's actions and ownership, methods, deliverables, audiences, and supported outcomes or metrics. Retain source-supported names in the CV itself rather than replacing them with generic phrases such as "banking clients", "enterprise systems", or "strategic projects", subject to explicit confidentiality constraints.
- Preserve JD-relevant education detail from the original CV, including core or selected coursework, concentrations, academic projects, and distinctions when supported. Do not automatically reduce Education to degree, institution, and dates merely to save space; shorten coursework only when it is genuinely irrelevant or a higher-value supported detail needs the space.
- Assess relevance at the responsibility or project level, not only by role title or recency. Give directly relevant parts enough space for specific evidence, including older roles. Summarize or omit low-relevance details while preserving accurate chronology; obtain explicit approval before removing or materially compressing key experience, even when it appears irrelevant to the JD. When uncertain whether experience is key, retain it and ask.
- Tailor through modest changes to emphasis, ordering, and wording. Preserve what the candidate actually did, the original scope, and the concrete details that support credibility. Never turn detailed work into vague claims of strategic impact, transformation, leadership, or capability merely to echo JD keywords.
- Before finalizing, compare the draft with the full candidate profile, latest candidate-edited source, original CV, and approved baseline when available. Check every relevant project, system, client, method, deliverable, and outcome for accidental loss. Record substantive omissions or compression and their JD-relevance or evidence rationale in the CV change record; page reduction alone is not a sufficient reason.
- For a baseline CV without a target JD, preserve the full supported experience and project detail for later tailoring. Adjust layout to the content rather than compressing the content to fit a template.

## Screening rules

- A predominantly German JD body is an immediate `FAIL` under the configured user screening rule. Apply the deterministic detector to the full normalized description before evaluating other requirements. Mixed or English descriptions continue through normal screening unless the detector classifies the body as German.
- Classify each criterion as `hard`, `soft`, or `learnable`.
- Record `hardness_basis` as `explicit`, `role_critical_inference`, `candidate_policy`, `user_override`, or `not_applicable`.
- Evaluate status as `met`, `partial`, `unmet`, or `unknown`.
- Show JD evidence, candidate evidence, confidence, reasoning, and targeted questions.
- Never allow a weighted score to override a hard blocker.

## Output contract

Reference the validated canonical `candidate-profile.json`, and maintain `jd-normalized.md`, `source-audit.md`, `screening-report.json`, `screening-report.md`, and `optimization-backlog.json`. For `PASS` or `OVERRIDDEN`, automatically add `case-config.json`, `cv-change-proposal.md`, and final CV files. Add cover-letter files only when that optional path is requested. Store portable relative paths in generated reports whenever possible.

Before final generation, preserve the draft configuration and readable draft, `work/review-handoff.json`, `review/content-review.md`, and `work/review-resolution.json` as described in the draft-review reference. A pending approval is a checkpoint, not a completed application. Review-only mode produces the review report and source/draft fingerprints without changing application content.

For discovery batches, create `batch-manifest.json` with the source run ID, candidate profile version, per-job gate and next action, aggregate gate counts, `mode: screen_and_advance`, and the automatically eligible application candidates.

Use English for artifacts and filenames. Communicate with the user in their preferred conversation language.

## Tools

- `scripts/audit_docx_ats.py <input.docx>`: detect structural ATS risks.
- `scripts/init_case.py <job-posting.json> --cases-root <cases-dir>`: create a final case only after employer and role verification.
- `scripts/build_application_docs.py <case-config.json>`: render approved CV and cover-letter DOCX files from case data without applicant-specific code.
- `scripts/normalize_job_html.py <input.html> --json <job.json> --markdown <jd.md>`: extract schema.org JobPosting data.
- `scripts/validate_case.py --candidate <candidate-profile.json> --policy <job-search-policy.json> --confirmations <candidate-confirmations.json> --screening <screening-report.json>`: enforce evidence, candidate-policy, and gate consistency.
- `scripts/materialize_screening_batch.py --candidate <profile.json> --policy <job-search-policy.json> --confirmations <candidate-confirmations.json> --manifest <run-manifest.json> --assessments <assessments.json> --output <dir>`: create validated batch screening artifacts and identify `PASS` or `OVERRIDDEN` jobs for automatic CV generation.
- `scripts/detect_jd_language.py <jobposting.json|jd.txt>`: classify the complete JD body before candidate matching and emit auditable detector evidence plus `JD_LANGUAGE_GERMAN` when the body is predominantly German.
- Reuse Browser for interactive/authenticated pages, PDF for PDF inspection, and Documents for DOCX generation and render QA.
