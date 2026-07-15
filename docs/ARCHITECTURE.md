# Architecture

## Context and boundaries

Pi loads `extensions/index.ts` in-process. The extension observes Bash tool calls, resolves configuration, delegates classification to pure policy code, and either allows, rewrites, warns, or blocks. It also registers repository-report, checkpoint, phase, and budget commands.

Pi Work Guard is a guardrail, not a security sandbox. Pi and allowed commands retain the current user's permissions.

Command classification uses bounded lexical tokenization to distinguish executable positions from quoted literals and comments. It recognizes only documented shell operators and PowerShell/cmd command wrappers; malformed or over-budget input is classified with the prior conservative matching behavior. This does not provide full shell parsing or change the security boundary.

## Components

| Component | Owns | Must not own |
| --- | --- | --- |
| `extensions/index.ts` | Pi event/command registration, session counters, widgets, notifications, metric dispatch | Classification regexes, config parsing policy, Git/file algorithms |
| `src/command-risk.ts` | Pure command classification and severity policy | Filesystem, Pi UI, execution, persistence |
| `src/work-guard-config.ts` | Defaults, precedence, validation, source/diagnostic reporting | Pi UI, process lifecycle, command decisions |
| `src/event-log.ts` | Privacy-minimized append, byte-boundary rotation, and status/error reporting | Command decisions, raw command text |
| `src/repo-guard.ts` | Bounded Git inspection, file-size report, checkpoint rendering | Command interception and config resolution |
| `scripts/` | Contributor/CI checks, coverage/release verification, reproducible benchmark | Runtime extension behavior |
| `tests/` | Policy, integration-harness, repository, configuration, privacy, release, and workflow contracts | Production state |

## Tool-call control flow

```text
Pi tool_call
  -> confirm Bash input
  -> load defaults -> global settings -> project JSON -> environment mode
  -> classify command (pure)
  -> apply mode and per-risk switches
  -> auto-fix OR block OR warn OR allow
  -> notify UI and append privacy-minimized metric when a risk is observed
```

Configuration read/parse failures never disable the guard. Resolution keeps lower-precedence valid values and exposes diagnostics through `/work-guard config`. Metric writes and rotation are best-effort; failures never break tool execution and surface as privacy-safe status.

## Command and persistence flow

- `/work-guard`: bounded Git status/diff-stat and tracked source file-size checks.
- `/work-guard config`: resolved values, ordered sources, validation diagnostics, and metric retention/error state.
- `/work-checkpoint`: a timestamped Markdown snapshot under `.rpiv/artifacts/work-checkpoints/`.
- `/work-phase` and `/work-budget`: in-memory session state; budget output also reads metric retention status.
- Risk events: complete JSON Lines under `.rpiv/artifacts/work-guard/events.jsonl`; byte-boundary rotation retains `events.previous.jsonl` and no raw command text.

Generated artifacts are local, gitignored, and outside the package's durable API.

## Extension points

1. Add a risk by extending `CommandRisk`, `analyzeBashCommand`, retry guidance, and tests together.
2. Add configuration only in `WorkGuardConfig`, defaults, validation/merge, config output, examples, and tests.
3. Add a Pi command in the extension; move reusable computation to `src/` first.
4. Add persistence only after documenting privacy, retention, failure behavior, and recovery.
5. New network calls, external services, executable side effects, or security boundaries require an architecture decision before implementation.

## Invariants

- Classifying a command is deterministic and side-effect free.
- A malformed override cannot silently turn the guard off.
- Blocking includes a bounded retry or corrective action.
- Metrics are best-effort and never include command text.
- Repository inspection uses bounded buffers and summary Git commands.
- Runtime code remains dependency-light and compatible with the supported Node/Pi range.
