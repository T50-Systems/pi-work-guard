# pi-work-guard

Memory-safe workflow guard for [Pi](https://pi.dev) that keeps shell output, repository checks, and long-running work within explicit budgets.

## Who it is for

Use `pi-work-guard` when agents work in repositories where an unbounded `git diff`, file read, or search can flood the context window. It is especially useful for long sessions that benefit from phase markers and resumable checkpoints.

## Features

- Blocks unbounded/high-output POSIX shell, PowerShell, and cmd.exe command forms and returns retry guidance to the agent.
- Supports configurable modes: `off`, `warn`, `block`, and `strict`.
- Optionally auto-fixes eligible simple commands; unsupported shell composition remains unchanged.
- Persists privacy-minimized, byte-bounded guard metrics with optional whole-file age retention to `.rpiv/artifacts/work-guard/events.jsonl`.
- Provides `/work-guard` for repository size/diff risk and `/work-guard config` for active rules and retention status.
- Provides `/work-checkpoint` for resumable checkpoints and `/work-phase` for phase markers.
- Ships coverage, file-size, release, and performance regression gates.

## Requirements

- Node.js 22 or newer
- Pi with package support
- Git for repository reports and file-size checks

Pi packages execute with the current user's permissions. Review the source before installing any extension.

## Install

Install directly from GitHub:

```bash
pi install git:github.com/T50-Systems/pi-work-guard
```

For local development, clone the repository and install the local package:

```bash
git clone https://github.com/T50-Systems/pi-work-guard.git
cd pi-work-guard
npm ci
npm test
pi install .
```

Restart Pi after installation. For a one-off smoke test without changing settings, run `pi -e .` from the repository.

## Quickstart

1. Start Pi in a trusted test repository.
2. Run `/work-guard config` and confirm the mode is `block`.
3. Run `/work-guard` to inspect file-size and working-tree risk.
4. Ask the agent to run an unbounded command such as `git diff`; WorkGuard should block it and suggest `git diff --stat`.
5. Mark work with `/work-phase start <name>` and create a checkpoint with `/work-checkpoint <note>`.

## Bash behavior guard

The extension allows low-risk warnings through, but blocks commands likely to flood context or memory:

- `git diff` without `--stat` or an output bound
- `cat`/`type`/`Get-Content` reads without an output bound
- `find`/`rg`/`grep`/`findstr`/`Select-String` searches without a recognized result cap
- extremely large commands

Pipelines, redirections, subshells, chaining, PowerShell, and cmd.exe forms are never auto-fixed because appending text could change their meaning. Blocked calls include a `pi-work-guard` reason and a bounded retry example.

Classification uses a bounded, quote-aware lexical scan of executable positions, shell operators, and recognized `pwsh`/`powershell -Command` and `cmd.exe /c` payloads. Quoted literals and comments are ignored when quoting is well formed; malformed or over-budget input falls back conservatively. This is policy-oriented tokenization, not a full shell parser or security sandbox.

## Configuration

Defaults are conservative: `mode: "block"`, `autoFix: false`, and all unbounded-output rules enabled.

Global config can live under `workGuard` in `~/.pi/agent/settings.json`:

```json
{
  "workGuard": {
    "mode": "block",
    "autoFix": false,
    "autoFixLineLimit": 200,
    "blockGitDiff": true,
    "blockFileRead": true,
    "blockSearch": true,
    "metricsEnabled": true,
    "metricsMaxBytes": 1048576,
    "metricsMaxAgeDays": null
  }
}
```

Project overrides can live at `.pi/work-guard.json` with the same shape. `PI_WORK_GUARD_MODE=off|warn|block|strict` overrides only the mode for one process.

Configuration precedence, from lowest to highest, is defaults, global settings, project override, then `PI_WORK_GUARD_MODE`. Invalid values retain the preceding valid value and appear as actionable diagnostics in `/work-guard config`. See [configuration, recovery, and observability](docs/OPERATIONS.md) and the [reviewed examples](examples/).

Modes:

- `off`: do nothing
- `warn`: notify and persist metrics, but never block
- `block`: block configured unbounded-output risks
- `strict`: also block warning-severity risks such as oversized commands/heredoc batches

Run `/work-guard config` to inspect resolved values, source precedence, diagnostics, and metric retention state. `/work-budget` also reports current bytes, the effective age policy, the process-local last successful age prune, and the last privacy-safe write error. If `autoFix` is enabled, only eligible simple commands are rewritten in place instead of blocked.

## Commands

```text
/work-guard
/work-guard config
/work-checkpoint [note]
/work-phase start <name>
/work-phase done [note]
/work-budget
```

## Metrics and privacy

Metrics include timestamps, working directory, action, mode, risk codes, and command length. Command text is deliberately not persisted because it may contain credentials or other sensitive values. The active file rotates at `metricsMaxBytes` (default 1 MiB) and retains one prior valid JSONL file. Optional `metricsMaxAgeDays` retention is disabled by default (`null`); when enabled, the next queued metric append removes stale active/previous files only as whole files according to filesystem modification time. Set `metricsEnabled: false` to disable writes and cleanup. Runtime metric and checkpoint files are gitignored by default.

## Troubleshooting

- **Commands are not intercepted:** restart Pi, run `pi list`, and confirm the package is enabled with `pi config`.
- **Project config is ignored:** trust the project, verify `.pi/work-guard.json` is valid JSON, then restart Pi.
- **A safe command is blocked:** add an explicit output bound or set the relevant `block*` option to `false` in project config.
- **Need to recover immediately:** start one process with `PI_WORK_GUARD_MODE=off pi`; avoid disabling the guard globally unless necessary.
- **No repository report data:** `/work-guard` depends on Git and returns empty Git sections outside a repository.

## Project documentation

- [Product vision and success measures](docs/PRODUCT.md)
- [Architecture and module boundaries](docs/ARCHITECTURE.md)
- [Configuration, recovery, and observability](docs/OPERATIONS.md)
- [Examples and recipes](docs/EXAMPLES.md)
- [Performance baseline](docs/PERFORMANCE.md)
- [Release process](docs/RELEASING.md)
- [Roadmap milestones](ROADMAP.md) and [changelog](CHANGELOG.md)

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the clone-to-verified-change workflow and [SECURITY.md](SECURITY.md) for reporting vulnerabilities. `npm test` runs required checks, while `npm run coverage` emits line, branch, function, and statement metrics and enforces documented floors.

## License

MIT
