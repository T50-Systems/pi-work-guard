# Configuration, recovery, and observability

## Configuration contract

Precedence is deterministic, lowest to highest:

1. built-in safe defaults;
2. `workGuard` in `~/.pi/agent/settings.json`;
3. `.pi/work-guard.json` in the current working directory;
4. `PI_WORK_GUARD_MODE` for the current process.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | `off \| warn \| block \| strict` | `block` | Overall enforcement. |
| `autoFix` | boolean | `false` | Rewrite eligible simple commands with a bound rather than block. |
| `autoFixLineLimit` | positive integer | `200` | Line cap appended by auto-fix. |
| `blockGitDiff` | boolean | `true` | Enforce the unbounded diff rule. |
| `blockFileRead` | boolean | `true` | Enforce unbounded POSIX/PowerShell/cmd file-read rules. |
| `blockSearch` | boolean | `true` | Enforce unbounded cross-shell search rules. |
| `metricsEnabled` | boolean | `true` | Persist privacy-minimized local risk events. |
| `metricsMaxBytes` | positive integer | `1048576` | Rotate the active event file before an append would exceed this byte budget. |
Unknown keys and invalid values are ignored individually. Malformed JSON invalidates that source. In both cases, the lower-precedence valid value remains active and `/work-guard config` reports the source and corrective diagnostic. Restart Pi after changing files.

Use [`examples/work-guard-balanced.json`](../examples/work-guard-balanced.json) for the default-style project policy or [`examples/work-guard-strict.json`](../examples/work-guard-strict.json) for strict enforcement.

## Diagnosis

Run `/work-guard config` first. Confirm:

- `mode` and all switches match intent;
- `sources` lists the expected global/project/environment chain;
- `diagnostics` is `none`, or correct each listed source;
- metric status shows the expected enabled state, current/max bytes, and no write error.

Then run `/work-budget` for in-session warning, block, auto-fix, retention, and last-write-error status. Run `/work-guard` for tracked source file-size issues and concise Git state.

Risk events are JSON Lines. Each event has `timestamp`, `cwd`, `action`, `mode`, `riskCodes`, and `commandLength`; command text is never persisted. Before an append crosses `metricsMaxBytes`, the complete active file is moved to `events.previous.jsonl`, any older previous file is removed, and the new active file starts with the complete pending line. Thus both retained files remain parseable JSONL and active growth is bounded. Enforcement continues if directory creation, rotation, or append fails.

To archive events, stop Pi and copy both `events.jsonl` and `events.previous.jsonl` to an access-controlled location, then remove the originals. New events recreate the active file. Do not attach event/checkpoint files to public issues without reviewing `cwd`, notes, and repository metadata.

## Recovery playbook

| Symptom | Recovery | Verification |
| --- | --- | --- |
| Expected package commands are absent | Restart Pi; verify installation with `pi list` and `pi config`. | `/work-guard config` renders. |
| Project override is ignored | Fix the exact JSON/type diagnostic and restart Pi. | Source appears with `diagnostics: none`. |
| Safe command is blocked | Add an explicit output bound; only then consider disabling the specific rule. | Retry succeeds and remains bounded. |
| Auto-fix changes semantics | Set `autoFix: false`; use the suggested explicit command. | Config output shows `autoFix: false`. |
| Immediate compatibility problem | Launch one process with `PI_WORK_GUARD_MODE=off pi`. | Config shows environment source and `off`. |
| Metrics cannot be written | Check the privacy-safe last error in `/work-budget`, then repository permissions and disk space. | A new risk appends one valid JSON line and status returns to `none`. |
| Metric budget is reached | No action is normally required; archive both JSONL files before manual removal if history is needed. | Active bytes stay at or below `metricsMaxBytes`; both files parse line-by-line. |
| Metrics must be disabled | Set `metricsEnabled: false` in reviewed configuration. | `/work-budget` reports `metrics: disabled` and no event file is created. |
| Checkpoint fails | Check `.rpiv/artifacts/` permissions and run `/work-guard` to isolate Git/report issues. | `/work-checkpoint test` reports a path. |
| Unexpected accumulated artifacts | Stop Pi, inspect, then archive or remove `.rpiv/artifacts/work-guard/` and `work-checkpoints/`. | Commands recreate directories on demand. |

`off` is an emergency bypass, not a default fix. It does not sandbox commands or undo prior side effects.
