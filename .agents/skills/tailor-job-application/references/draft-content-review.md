# Draft Content Review

Use this procedure for initial drafts, independent review, and content revisions. The content owner retains case ownership. The independent reviewer writes only their review report, never the candidate profile, draft, resolution record, or generated files. Do not treat generated wording or earlier screening conclusions as primary evidence.

## Scope and dispatch

Use one content owner and one reviewer per job, following the models in the repository `AGENTS.md`. The owner handles screening, drafting, revision, generation, and file QA; deterministic scripts handle repeatable transformations. Do not create separate cover-letter or formatting agents by default. For multiple jobs, use separate job execution contexts, not one growing chat containing every JD. Valid profile preparation need not be repeated daily.

Start the reviewer with no inherited conversation (`fork_turns: "none"` where available). Pass a short task, the handoff path, output path, selected model/reasoning, and authorized scope. Do not send the writer's reasoning, chat history, screenshots, prior self-review, or an expected conclusion. If independent execution or the requested model is unavailable, preserve the draft and report the limitation; do not label a self-review independent or silently switch models.

For review-only requests, accept the supplied draft and available original sources, record missing evidence as a review limitation, and produce findings only. Do not require a generation-ready case, create documents, or re-run job discovery. Subsequent editing needs authorization under the rules below.

## Artifacts and evidence

Keep all case data in ignored runtime directories. Before dispatch, the owner saves:

- `work/case-config.draft.json`: the builder-compatible draft data, including requested cover-letter content. Preserve the reviewed revision rather than overwriting it during feedback resolution.
- `work/application-draft.md`: all CV text and any requested cover letter, in intended section order. Keep annotations separate from candidate-facing text. Generate it from the same draft configuration and verify consistency.
- `work/review-handoff.json`: `schema_version`, `case_id`, `draft_revision`, `sources`, `authorized_overrides`, `review_scope`, `report_path`. Each source records its role, portable path, SHA-256, and version/as-of when applicable. Include the draft configuration and readable draft; the complete JD; full baseline and extracted text; canonical profile, ledger, and policy; latest candidate-edited source when available; primary evidence index; and change record. Overrides require their scope and user-message locator or active confirmation reference. Mark genuinely absent optional sources explicitly.

The reviewer independently reads the full JD, readable draft, and baseline text, then the complete canonical facts and relevant active confirmations/constraints. Consult the latest candidate-edited source and primary evidence for material claims, conflicts, and omissions. Evidence remains accessible beyond any writer-selected excerpt. Read earlier screening conclusions and change rationale only after forming the initial evidence-based assessment. Preserve authorized overrides; do not reinstate a gate already explicitly waived for this job.

Reuse baseline extraction/ATS/visual audit artifacts only if source hashes, audit method, and recorded page checks match. A changed baseline invalidates the cached audit; changes to canonical facts or confirmations invalidate dependent interpretations even if baseline bytes are unchanged. File pointers reduce chat duplication but file reads still consume tokens. Preserve full required sources rather than imposing a token cap that hides evidence.

## Review findings

Write `review/content-review.md`, identifying case, scope, source/draft fingerprints, reviewer model/reasoning, and execution identity when exposed. If an identity is unavailable, say so. Evaluate:

- claim support, dates, tools, credentials, ownership, scope, and attribution of metrics;
- whether the reader can understand the business context and metric definitions, even for candidate-confirmed claims;
- JD-specific emphasis, relevant older work, important omissions, education/projects, and accidental compression;
- readability, vague keyword substitution, repetition, and cover-letter duplication of the CV;
- unresolved evidence and practical limitations without inventing new fit gates or outcomes.

Use stable finding IDs. For each actionable finding record category, priority, draft location, original text (or the missing baseline content), proposed text/change, rationale, evidence locators, risk/consequence, and whether user approval is required. Categories are `editorial`, `new_fact`, `ambiguous_claim`, `evidence_conflict`, and `key_experience_omission`. A finding is advice, not proof that the proposed wording is true.

## Automatic edits and scoped approval

Apply fully supported wording, ordering, grammar, repetition removal, and formatting refinements automatically when they preserve meaning and substantive experience. This authorization does not cover dropping substantive evidence merely because two passages mention the same topic.

Before changing content for any of the following, present the finding and obtain explicit approval:

- a candidate fact absent from the verified/source-supported fact base;
- ambiguous measures, attribution, job scope, chronology, credentials, or conflicting evidence;
- deleting, omitting, or materially compressing key roles, projects, responsibilities, client/system detail, or supported outcomes, including when they seem irrelevant to this JD.

Treat a role or named project, distinctive responsibility, supported metric/outcome, user-highlighted experience, and the concrete detail necessary to understand ownership as key. Minor redundant wording can be shortened automatically only if substantive information remains. When unsure, retain the content and ask. This applies to the initial draft too: do not preemptively remove key baseline content and seek approval only after it has disappeared.

Show original, proposed change, reason, evidence, and consequence in a concise grouped request. Continue unrelated supported edits while waiting; keep affected content unchanged. Do not write uncertain new assertions into the draft while waiting. Do not interpret silence, a general instruction to generate materials, job-level gate overrides, or approval of another finding as approval of these edits.

Record each finding's disposition in `work/review-resolution.json`: `finding_id`, `category`, `decision` (`applied`, `rejected`, `pending`), exact original/proposed text, rationale, evidence, and approval when required. Approval records include the exact user answer, source chat/message locator, timestamp, finding IDs, and approved proposal revision/fingerprint. Changed proposals need renewed approval. Rejection of a review suggestion needs a reason and does not cure unsupported content already present in the draft.

Approval to edit does not itself validate a new fact. Send new or conflicting candidate facts to profile preparation for evidence/ledger revision, then refresh dependent fingerprints and screening if relevant before use. Never let the reviewer or content owner silently mutate canonical candidate data.

## Resolution, finalization, and cost control

Default to one full independent content review. The owner resolves findings and performs targeted verification against evidence. Ask the same reviewer to check only affected sections/findings if substantive issues remain; provide the changed revision, exact diff, and relevant original sources. New facts, source changes, or material new claims require expanded review of their implications. Do not repeat a full review for grammar or formatting alone. If material issues remain after a targeted follow-up, checkpoint and report them instead of starting an open-ended rewrite loop.

Before final generation, record in the resolution file the reviewed draft revision/fingerprint, resulting configuration fingerprint, source fingerprints, and status (`ready_for_generation` or `pending_user_input`). Ensure all findings are disposed of, sensitive applied changes have scoped approval, material claim-support defects are resolved, and no pending decision remains. Rejected deletion suggestions leave the original supported experience in place. If the user declines to clarify a claim that cannot be supported safely, preserve the checkpoint and explain why finalization remains blocked; do not invent a resolution.

Preserve the reviewed draft files. Save revisions as `work/case-config.revised.json` and `work/application-draft.revised.md` (version them for further revisions), and reference their paths and hashes in the resolution. Write `work/case-config.json` only after the conditions above hold, with content matching the resolved readable draft. Generate DOCX/PDF using the existing builder and Documents workflow. Check every final page visually and verify text extraction; review the cover letter too when requested. Changed pagination requires page QA, while substantive text changes also require the affected content checks. Record the final configuration/output hashes and QA result with the case.

The coordinator receives status, counts, artifact paths, and unresolved questions; it checks provenance and exceptions without redoing the full analysis. Record actual model/reasoning and available token/usage telemetry per stage, keeping cached and uncached input distinct. Do not sum shared account usage percentages across workers. These are workflow instructions, not a hard token cap or a programmatic approval gate in the existing document builder; do not claim measured savings before comparable runs exist.
