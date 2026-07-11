# Product vision and success measures

## Vision

Pi Work Guard makes long coding-agent sessions predictably bounded and recoverable without requiring users to inspect every shell command. It is a local safety rail, not a sandbox or authorization boundary.

## Users and outcomes

| User | Need | Outcome |
| --- | --- | --- |
| Pi user | Avoid context- or memory-flooding commands | Risky output is blocked, bounded, or explained before execution. |
| Long-session operator | Resume work after interruption | Checkpoints and phase state make the next action explicit. |
| Repository maintainer | Apply consistent budgets | Configuration and file-size checks are deterministic and inspectable. |
| Contributor | Change policy safely | Module boundaries, examples, tests, and benchmarks expose the contract. |

## Product principles

1. **Bound before execution.** Prefer a smaller retry over processing excessive output.
2. **Fail safe, explain clearly.** Invalid configuration retains the last valid lower-precedence value and appears in `/work-guard config`.
3. **Local and privacy-minimized.** No network service is required; metrics omit command text.
4. **Observable, not noisy.** Status commands and structured local events explain decisions without becoming a telemetry platform.
5. **Small extension surface.** Policy remains pure and testable; Pi integration owns UI and lifecycle only.

## Success measures

Review these measures at each minor release. They are targets, not claims about current usage.

| Measure | Target | How to verify |
| --- | --- | --- |
| Critical policy regression rate | 0 known releases that allow covered unbounded commands | `npm test`; each fixed regression adds a focused test. |
| Safe fallback coverage | 100% of invalid documented config value classes retain safe values | `tests/work-guard-config.test.mjs`. |
| Classifier baseline | At least 1,000 classifications/second on supported Node 22 CI-class hardware | `npm run benchmark:verify`. |
| Release consistency | Version, lockfile, changelog, and package contents agree | `npm run verify:release`. |
| Recovery documentation | Every user-facing blocked/configuration state has a next action | Review `docs/OPERATIONS.md` and `docs/EXAMPLES.md`. |
| Privacy contract | 0 persisted raw command strings in current metrics | `tests/work-guard.test.mjs`. |

Metrics are evaluated from tests, benchmark output, release checks, and optional local aggregate event counts. The project does not collect user telemetry. Do not upload `.rpiv/artifacts/` merely to calculate KPIs.

## Non-goals

- Preventing malicious commands or replacing OS/container isolation.
- Remotely collecting commands, repository contents, or operational telemetry.
- Automatically executing recovery or changing repository state.
- Guaranteeing a fixed memory ceiling for Pi or external tools.
