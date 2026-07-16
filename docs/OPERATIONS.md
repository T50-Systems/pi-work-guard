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
| `enforceAgentBudget` | boolean | `true` | Require and enforce explicit `max_turns` on Agent tool calls. |
| `maxAgentTurns` | positive integer | `25` | Maximum turns for non-Plan Agent calls. |
| `maxPlanAgentTurns` | positive integer | `15` | Maximum turns for Plan agents, capped by `maxAgentTurns`. |
| `metricsEnabled` | boolean | `true` | Persist privacy-minimized local risk events. |
| `metricsMaxBytes` | positive integer | `1048576` | Rotate the active event file before an append would exceed this byte budget. |
| `metricsMaxAgeDays` | positive integer or `null` | `null` | Optional whole-file age limit. `null` disables age pruning; a number prunes event files by modification time before queued appends. |
Unknown keys and invalid values are ignored individually. Malformed JSON invalidates that source. In both cases, the lower-precedence valid value remains active and `/work-guard config` reports the source and corrective diagnostic. Restart Pi after changing files.

Use [`examples/work-guard-balanced.json`](../examples/work-guard-balanced.json) for the default-style project policy or [`examples/work-guard-strict.json`](../examples/work-guard-strict.json) for strict enforcement.

## Diagnosis

Run `/work-guard config` first. Confirm:

- `mode` and all switches match intent;
- `sources` lists the expected global/project/environment chain;
- `diagnostics` is `none`, or correct each listed source;
- metric status shows the expected enabled state, byte budget, effective age policy, last successful age prune, and no write error.

Then run `/work-budget` for in-session warning, block, auto-fix, retention, last-successful-prune, and last-write-error status. Run `/work-guard` for tracked source file-size issues and concise Git state.

Risk events are JSON Lines. Every event has `timestamp`, `cwd`, `action`, `mode`, and `riskCodes`. Bash events add `commandLength`; Agent events add `toolName`, a coarse `agentClass` (`plan` or `other`), and requested/effective turn budgets when present. Command text and Agent prompts are never persisted. Before an append crosses `metricsMaxBytes`, the complete active file is moved to `events.previous.jsonl`, any older previous file is removed, and the new active file starts with the complete pending line. Thus both retained files remain parseable JSONL and the active file stays within the configured byte budget during normal writes.

`metricsMaxAgeDays` is disabled by default with `null`. When it is a positive integer, age cleanup runs before byte rotation and append, inside the same in-process per-working-directory queue used for metric writes. Cleanup checks `events.jsonl` and `events.previous.jsonl` independently and deletes only an entire file; it never parses event timestamps, filters lines, truncates a file, or rewrites content. Disabling metrics with `metricsEnabled: false` also disables age cleanup because no metric append is queued. Status commands only observe state and never trigger cleanup.

Age is based on filesystem modification time (`mtime`), not the timestamps inside JSON Lines. The queued append samples the system wall clock once and treats a file as stale when `mtime <= sampled time - (metricsMaxAgeDays * 24 hours)`. An exact cutoff is therefore stale. A future `mtime`, including one produced by a backward clock adjustment, is retained until the wall clock catches up; a forward clock adjustment can make whole files eligible earlier. There is no background timer, so eligible files remain until the next metric append. External changes to a file's `mtime` affect the next decision.

`metrics last successful age prune` is `none` until an age-enabled append has checked both paths successfully; it then shows that append's sampled clock even when no file needed deletion. This process-local status resets when Pi restarts and contains no event content. `ENOENT` is a successful absent-file check. A clock, stat, or removal failure records only a privacy-safe error and does not advance the last successful prune. If cleanup succeeds but later rotation or append fails, the successful-prune time does advance while the write error is also reported. The next event retries failed work. Command enforcement continues regardless because persistence remains best-effort; a partial cleanup can remove one whole file before another filesystem operation fails, but it never creates partial JSONL.

To archive events, stop Pi and copy both `events.jsonl` and `events.previous.jsonl` to an access-controlled location, then remove the originals. New events recreate the active file. Do not attach event/checkpoint files to public issues without reviewing `cwd`, notes, and repository metadata.

## Recovery playbook

| Symptom | Recovery | Verification |
| --- | --- | --- |
| Expected package commands are absent | Restart Pi; verify installation with `pi list` and `pi config`. | `/work-guard config` renders. |
| Project override is ignored | Fix the exact JSON/type diagnostic and restart Pi. | Source appears with `diagnostics: none`. |
| Safe command is blocked | Add an explicit output bound; only then consider disabling the specific rule. | Retry succeeds and remains bounded. |
| Agent call is blocked | Add a positive `max_turns` no greater than the displayed limit, or revise the reviewed project policy. | Retry succeeds and `/work-budget` records no new block. |
| Auto-fix changes semantics | Set `autoFix: false`; use the suggested explicit command. | Config output shows `autoFix: false`. |
| Immediate compatibility problem | Launch one process with `PI_WORK_GUARD_MODE=off pi`. | Config shows environment source and `off`. |
| Metrics cannot be written | Check the privacy-safe last error in `/work-budget`, then repository permissions and disk space. | A new risk appends one valid JSON line and status returns to `none`. |
| Metric budget is reached | No action is normally required; archive both JSONL files before manual removal if history is needed. | Active bytes stay at or below `metricsMaxBytes`; both files parse line-by-line. |
| Age pruning is not running | Confirm `metricsEnabled: true` and a positive `metricsMaxAgeDays`, then cause a risk event; status commands do not prune. | `/work-budget` shows the effective age policy and a new last successful age prune. |
| Age pruning reports an error | Check the privacy-safe last error, permissions, file types, disk state, and system clock; do not edit JSONL in place. | A later risk event succeeds, advances last successful prune, and leaves only complete JSONL files. |
| Metrics must be disabled | Set `metricsEnabled: false` in reviewed configuration. | `/work-budget` reports `metrics: disabled` and no event file is created. |
| Checkpoint fails | Check `.rpiv/artifacts/` permissions and run `/work-guard` to isolate Git/report issues. | `/work-checkpoint test` reports a path. |
| Unexpected accumulated artifacts | Stop Pi, inspect, then archive or remove `.rpiv/artifacts/work-guard/` and `work-checkpoints/`. | Commands recreate directories on demand. |

`off` is an emergency bypass, not a default fix. It does not sandbox commands or undo prior side effects.
