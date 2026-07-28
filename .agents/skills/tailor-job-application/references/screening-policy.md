# Screening Policy

## Decision order

1. Extract the exact JD statement.
2. Decide whether it is hard, soft, or learnable.
3. Find candidate evidence without rewriting it.
4. Apply an explicit candidate-side policy gate only when a resolved policy item and active confirmation-ledger entry authorize it.
5. Assign `met`, `partial`, `unmet`, or `unknown`.
6. Apply the gate before discussing an overall score.

## Germany-focused defaults

Treat work authorization, legally required status, non-negotiable location/travel, mandatory licences, explicit minimum directly relevant years, and explicit fluent/business-fluent/C1/C2/native German as hard. Apply the user's rejection preference to an entirely German JD with no English-workplace signal, but label this as user policy rather than an employer statement.

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
