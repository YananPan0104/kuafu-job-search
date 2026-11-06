# Screening Policy

## Decision order

The German-JD stop is the default user screening rule, not an exception to the explicit-override mechanism. If the user explicitly waives it for this job, preserve the detector result, hard unmet requirement, and underlying `FAIL`; record effective `OVERRIDDEN` and authorization provenance, then continue other screening. A general request to generate materials or an override for another job is insufficient. Overrides never relax discovery access/authentication stops or authorize unsupported content.

1. Run the deterministic language precheck on the complete normalized JD body.
2. If the body is classified as German, record `JD_LANGUAGE_GERMAN`, add a hard unmet language requirement with `hardness_basis: user_override`, assign `FAIL`, and stop screening that job.
3. Otherwise, extract the exact JD statement.
4. Decide whether it is hard, soft, or learnable.
5. Find candidate evidence without rewriting it.
6. Apply an explicit candidate-side policy gate only when a resolved policy item and active confirmation-ledger entry authorize it.
7. Assign `met`, `partial`, `unmet`, or `unknown`.
8. Apply the gate before discussing an overall score.

## Germany-focused defaults

Treat work authorization, legally required status, non-negotiable location/travel, mandatory licences, explicit minimum directly relevant years, and explicit fluent/business-fluent/C1/C2/native German as hard.

Apply the configured user rule to the JD body itself: when `detect_jd_language.py` classifies the complete normalized description as predominantly German, fail it immediately. Record the detector version, marker counts, ratio, and evidence terms in the screening artifact. Label the requirement `user_override`; it is a user screening rule rather than an employer-stated candidate requirement. Do not classify from the title, company, location, `m/w/d`, isolated German words, or a short bilingual fragment. Mixed or English bodies proceed through normal screening.

Treat named tools, platforms, methods, and preferred/advantageous criteria as soft or learnable unless they are legally required, safety-critical, explicitly mandatory, or indispensable to the core duties.

Treat location, work mode, employment type, travel, compensation, language-environment, or similar candidate choices as hard only when `policy.screening_gates` explicitly marks them active and cites an active scoped confirmation. Label their hardness basis `candidate_policy`, not `explicit`. Search-only preferences remain search heuristics.

Do not infer a German requirement merely because the role is in Germany.

## Role-critical inference

A profile item may be hard without the word `must` when it is indispensable to most core responsibilities. Mark it as `role_critical_inference`, explain why, and allow user override. Do not silently make every profile bullet hard.

## Gate

- `PASS`: every hard item is `met`.
- `HOLD`: no hard item is `unmet`, but at least one is `partial` or `unknown`.
- `FAIL`: at least one hard item is `unmet`.
- `OVERRIDDEN`: the user explicitly authorizes tailoring despite `HOLD` or `FAIL`; preserve the underlying gate and reason.

Store learnable gaps separately with evidence status, effort, application risk, suggested proof, and `allowed_in_cv`. Default `allowed_in_cv` to `false`.
