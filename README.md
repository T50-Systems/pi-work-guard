# pi-work-guard

Memory-safe workflow guard for Pi sessions.

`pi-work-guard` helps coding agents avoid commands that flood the context window, exhaust memory, or make large work sessions hard to resume. It guards risky shell patterns, provides checkpoint/phase commands, records metrics, and ships a file-size budget check for package development.

## Features

- Blocks or warns on unbounded/high-output bash commands.
- Supports modes: `off`, `warn`, `block`, and `strict`.
- Optionally auto-fixes eligible risky commands by adding bounded output.
- Persists guard metrics to `.rpiv/artifacts/work-guard/events.jsonl`.
- `/work-guard` inspects repository size and diff risk.
- `/work-guard config` shows active rules and config sources.
- `/work-checkpoint` writes a resumable checkpoint file.
- `/work-phase` records start/done phase markers.
- `/work-budget` reports current budget status.
- `npm run check:file-size` enforces source/test file-size limits.

## Bash behavior guard

The extension can block commands that are likely to produce unbounded output:

- `git diff` without `--stat`, `--name-only`, or another output bound.
- `cat` / `type` reads without `head`, `sed -n`, `tail`, or similar limits.
- `find`, `rg`, or `grep` searches without result/count bounds.
- Extremely large commands or heredoc batches in strict mode.

Blocked calls include a `pi-work-guard` reason with concrete retry guidance so the agent can rerun a safer bounded command.

## Configuration

Defaults are conservative:

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

Global config can live under `workGuard` in `~/.pi/agent/settings.json`. Project overrides can live at `.pi/work-guard.json`. `PI_WORK_GUARD_MODE=off|warn|block|strict` overrides only the mode for one process.

## Modes

- `off` — do nothing.
- `warn` — notify and persist metrics, but never block.
- `block` — block configured unbounded-output risks.
- `strict` — also block warning-severity risks such as oversized commands/heredocs.

## Commands

```text
/work-guard
/work-guard config
/work-checkpoint [note]
/work-phase start <name>
/work-phase done [note]
/work-budget
```

## Repository layout

```text
extensions/index.ts         Pi extension entrypoint
src/command-risk.ts         command classifier and retry guidance
src/repo-guard.ts           repository/diff/file-size risk helpers
scripts/check-file-size.mjs file-size budget check
tests/work-guard.test.mjs   node:test unit coverage
```

## Install

From GitHub:

```bash
pi install git:github.com/T50-Systems/pi-work-guard
```

From a local checkout:

```bash
git clone https://github.com/T50-Systems/pi-work-guard
cd pi-work-guard
pi install .
```

## Development

```bash
npm install
npm run typecheck
npm run test:unit
npm run check:file-size
npm test
```

## License

MIT
