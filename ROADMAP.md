# Roadmap

This repository roadmap groups the remaining GitHub roadmap issues into reviewable outcomes. It does not replace issue state or close work automatically.

## Foundation milestone: a maintainable operating contract

| Issue | Foundation delivered | Evidence |
| --- | --- | --- |
| #2 Vision and metrics | Users, outcomes, non-goals, and release-review targets | `docs/PRODUCT.md` |
| #4 Architecture | Components, ownership, flows, invariants, extension points | `docs/ARCHITECTURE.md` |
| #6 Tests | Config precedence, validation, malformed input, safe fallback | `tests/work-guard-config.test.mjs` |
| #8 Release workflow | Changelog convention, procedure, executable consistency check | `CHANGELOG.md`, `docs/RELEASING.md`, `npm run verify:release` |
| #10 Configuration | Explicit schema/precedence, examples, runtime diagnostics | `src/work-guard-config.ts`, `docs/OPERATIONS.md`, `examples/` |
| #11 Recovery | Symptom/recovery/verification playbook | `docs/OPERATIONS.md` |
| #12 Observability | Status surfaces, event schema, privacy and rotation guidance | `docs/OPERATIONS.md` |
| #13 Performance | Deterministic classifier corpus and regression floor | `scripts/benchmark.mjs`, `docs/PERFORMANCE.md` |
| #14 User workflows | Config diagnostics and bounded recovery paths | `/work-guard config`, `docs/EXAMPLES.md` |
| #15 Examples | Balanced/strict policies and task recipes | `examples/`, `docs/EXAMPLES.md` |
| #16 Backlog | This milestone grouping and explicit follow-on/defer policy | `ROADMAP.md` |

## Next milestone: policy precision

Prioritize evidence-backed false-positive/false-negative fixes in command classification, especially shell composition and platform-specific syntax. Each change needs a minimal reproducer, focused policy test, bounded retry, and benchmark run. Label isolated fixtures/docs as beginner-friendly; keep parser or security-boundary changes maintainer-led.

## Later milestone: operational maturity

Consider machine-readable diagnostics, additional retention controls, benchmark history, and automated release drafting only after real usage demonstrates value. Each must preserve local-only operation and command-text privacy.

## Deferred unless an ADR justifies them

- Remote telemetry or hosted dashboards.
- Automatic command execution during recovery.
- A full shell parser or sandbox claim.
- Automatic package publishing or credentials in pull-request workflows.
- Persistent cross-session phase state.

## Triage cadence

At each minor release, maintainers should review open roadmap items against the product targets, move actionable work into the next milestone, mark approachable scoped work with `good first issue`, and explicitly defer ideas that lack evidence. GitHub issue closure and milestone changes remain deliberate maintainer actions; repository documents alone do not perform them.
