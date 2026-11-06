# Repository instructions

- Keep reusable skill logic candidate-neutral. Candidate facts, CVs, job descriptions, screening outputs, and generated application documents belong in ignored runtime directories.
- Treat `.agents/skills/` as the canonical source for repo-local Codex skills.
- Preserve evidence provenance across candidate profiles, search policies, discovery artifacts, screening decisions, and tailored documents.
- Do not automate job application submission or bypass authentication, access controls, challenges, or private APIs.
- Prefer English for code, identifiers, comments, configuration, commit messages, and reusable documentation. Candidate-facing documentation may be localized.
- Run `scripts/test.ps1` before committing changes to skill scripts.

## Conversational trigger aliases

- Treat `开启今日职位扫描` and `开始今日职位扫描` as exact project-level aliases for the following instruction: use the dedicated persistent Chrome profile to run the `yanan-pan` Phase 1-3 daily Smart Search workflow with the full active daily portfolio; validate inputs, prevent duplicate daily runs, verify the visible `Past 24 hours` filter, record Smart Search semantic-relevance ranking, stop at the visible related-results boundary, collect and deduplicate exact-match cards, apply first-level triage, extract and checkpoint complete JDs, materialize and validate the discovery run, then stop before screening, document generation, scheduling, or application actions.
- On login expiry, MFA, CAPTCHA, access challenge, material DOM drift, incomplete visible-filter verification, profile lock, or browser disconnection, preserve the checkpoint, stop safely, and report the required user action. Never weaken these stop conditions to satisfy the alias.
- If a run for the same daily trigger already exists, do not silently create a duplicate. Report it as complete, resumable, or requiring an explicitly named recovery run.

## Skill subagent execution policy

- Treat the three candidate-job-search skills as a serial pipeline of subagents when the task invokes more than one of them: `prepare-candidate-job-search` first, `discover-linkedin-job-postings` second, and `tailor-job-application` third.
- Do not run these subagents concurrently when a later stage depends on the canonical profile, confirmation ledger, discovery manifest, or extracted JD produced by an earlier stage. The root agent coordinates handoffs and validates each stage before starting the next.
- Use these default model assignments unless the user explicitly requests another model: root interaction/coordinator `gpt-6.1-sol` with medium reasoning; Profile Agent `gpt-6.1-sol` with high reasoning; Discovery Agent `gpt-6-luna` with high reasoning; Tailoring content owner `gpt-6.1-sol` with medium reasoning; independent content reviewer `gpt-6.1-sol` with high reasoning. Escalate the content owner's reasoning to high for ambiguous evidence or consequential claim interpretation. These are execution defaults, not a command to change the desktop model picker; verify actual worker model selection at dispatch and report an unavailable model rather than silently substituting it.
- Luna is sufficient for high-volume deterministic discovery, deduplication, checkpointing, and bounded retry work. Preserve all existing discovery stop conditions; escalate the Discovery Agent to a stronger model when the task requires material DOM-drift interpretation, complex recovery, or ambiguous evidence judgement.
- Keep profile ownership with the Profile Agent, discovery-run ownership with the Discovery Agent, and application-case/document ownership with the Tailoring Agent. Do not let multiple agents mutate the same canonical artifact at the same time.
- The UI collaboration tools are the default execution path for this subagent pipeline. CLI scripts remain available for deterministic validation, rendering, batch operations, and unattended or scheduled runs; CLI use is not required for ordinary serial subagent execution.

## Tailoring review and context policy

- Apply the draft-review workflow even for a directly supplied single JD. Use one content owner per job and one independent, read-only content reviewer; do not add separate screening, cover-letter, or formatting agents by default. The root may serve as content owner for one job. Reuse an unchanged valid profile rather than re-running profile preparation daily.
- Keep each job's execution context separate. Start independent reviewers without inherited conversation history (`fork_turns: "none"` where supported). Dispatch using artifact paths, versions, source fingerprints, authorized overrides, and a short task; do not forward full chats, browser snapshots, or the writer's reasoning. File reads still consume tokens.
- The reviewer must independently read the full JD, full draft, and full baseline text, and have access to the complete canonical profile, confirmation ledger, latest candidate-edited source, and primary evidence. Do not limit review to writer-selected claims. The root checks handoff status, provenance, and exceptions without repeating the entire worker analysis.
- Default to one content review followed by targeted verification of affected findings; expand review only for new evidence, material new claims, or unresolved substantive issues. Do not silently truncate discovery scope or evidence checks to meet a token target.
- Automatically apply evidence-supported wording, ordering, and formatting refinements. Before proposing a new candidate fact, resolving an ambiguous metric/claim or conflicting evidence, or deleting, omitting, or materially compressing key experience, show the original, proposed change, rationale, evidence, and consequence and obtain the user's explicit approval before changing that content. Perceived JD irrelevance does not waive approval for key experience. Protect this boundary during initial drafting as well as revision.
- Persist approval scope and user-message provenance with the case. Approval to edit does not verify a new fact: canonical fact changes return to the Profile Agent. Follow `.agents/skills/tailor-job-application/references/draft-content-review.md` for artifact and finalization rules. Preserve existing screening gates, discovery safety stops, and the daily alias's Phase 1-3 stopping boundary.
