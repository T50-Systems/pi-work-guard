# pi-work-guard

Memory-safe workflow guard for Pi.

## Features

- Blocks unbounded/high-output bash commands and returns retry guidance to the agent.
- Supports configurable modes: `off`, `warn`, `block`, and `strict`.
- Optionally auto-fixes risky bash commands by adding bounded output.
- Persists guard metrics to `.rpiv/artifacts/work-guard/events.jsonl`.
- Provides `/work-guard` to inspect repository size/diff risk and `/work-guard config` to inspect active rules.
- Provides `/work-checkpoint` to write a resumable checkpoint file.
- Provides `/work-phase` to mark current work phase.
- Ships `npm run check:file-size` for enforcing file-size budgets.

## Bash behavior guard

The extension allows low-risk warnings through, but blocks commands that are likely to flood context or memory:

- `git diff` without `--stat` or an output bound
- `cat`/`type` reads without an output bound
- `find`/`rg`/`grep` searches without `head`, `sed -n`, `-m`, `--max-count`, `--count`, or `--files`
- extremely large commands

Blocked tool calls include a `pi-work-guard` reason with concrete retry guidance, so the agent can retry with a bounded command instead of merely showing a UI warning.

## Configuration

Defaults are conservative: `mode: "block"`, `autoFix: false`, and all unbounded git diff/file-read/search rules enabled.

Global config can live under `workGuard` in `~/.pi/agent/settings.json`:

```json
{
  "workGuard": {
    "mode": "block",
    "autoFix": false,
    "autoFixLineLimit": 200,
    "blockGitDiff": true,
    "blockFileRead": true,
    "blockSearch": true
  }
}
```

Project overrides can live at `.pi/work-guard.json` with the same shape. `PI_WORK_GUARD_MODE=off|warn|block|strict` overrides only the mode for one process.

Modes:

- `off`: do nothing
- `warn`: notify and persist metrics, but never block
- `block`: block configured unbounded-output risks
- `strict`: also blocks warning-severity risks such as oversized commands/heredoc batches

Run `/work-guard config` to inspect the active config and metrics path. If `autoFix` is enabled, eligible commands are rewritten in place instead of blocked.

## Install

```bash
pi install .
```

## Commands

```text
/work-guard
/work-guard config
/work-checkpoint [note]
/work-phase start <name>
/work-phase done [note]
/work-budget
```
