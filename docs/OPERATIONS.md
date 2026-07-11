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
| `autoFix` | boolean | `false` | Rewrite eligible commands with a bound rather than block. |
| `autoFixLineLimit` | positive integer | `200` | Line cap appended by auto-fix. |
| `blockGitDiff` | boolean | `true` | Enforce the unbounded diff rule. |
| `blockFileRead` | boolean | `true` | Enforce the unbounded `cat`/`type` rule. |
| `blockSearch` | boolean | `true` | Enforce the unbounded search rule. |

Unknown keys and invalid values are ignored individually. Malformed JSON invalidates that source. In both cases, the lower-precedence valid value remains active and `/work-guard config` reports the source and corrective diagnostic. Restart Pi after changing files.

Use [`examples/work-guard-balanced.json`](../examples/work-guard-balanced.json) for the default-style project policy or [`examples/work-guard-strict.json`](../examples/work-guard-strict.json) for strict enforcement.

## Diagnosis

Run `/work-guard config` first. Confirm:

- `mode` and all switches match intent;
- `sources` lists the expected global/project/environment chain;
- `diagnostics` is `none`, or correct each listed source;
- `metrics` points inside the intended repository.

Then run `/work-budget` for in-session warning, block, and auto-fix counts. Run `/work-guard` for tracked source file-size issues and concise Git state.

Risk events are JSON Lines. Each event has `timestamp`, `cwd`, `action`, `mode`, `riskCodes`, and `commandLength`. It deliberately has no command string. Counters reset with the Pi process; the event file persists until the user rotates or removes it.

Example local inspection:

```bash
node -e "const fs=require('fs');const p='.rpiv/artifacts/work-guard/events.jsonl';for(const l of fs.readFileSync(p,'utf8').trim().split(/\n/)){const e=JSON.parse(l);console.log(e.timestamp,e.action,e.riskCodes.join(','))}"
```

Do not attach event/checkpoint files to public issues without reviewing `cwd`, notes, and repository metadata.

## Recovery playbook

| Symptom | Recovery | Verification |
| --- | --- | --- |
| Expected package commands are absent | Restart Pi; verify installation with `pi list` and `pi config`. | `/work-guard config` renders. |
| Project override is ignored | Fix the exact JSON/type diagnostic and restart Pi. | Source appears with `diagnostics: none`. |
| Safe command is blocked | Add an explicit output bound; only then consider disabling the specific rule. | Retry succeeds and remains bounded. |
| Auto-fix changes semantics | Set `autoFix: false`; use the suggested explicit command. | Config output shows `autoFix: false`. |
| Immediate compatibility problem | Launch one process with `PI_WORK_GUARD_MODE=off pi`. | Config shows environment source and `off`. |
| Metrics cannot be written | Check repository/directory permissions and available disk space. | A new risk appends one valid JSON line. |
| Checkpoint fails | Check `.rpiv/artifacts/` permissions and run `/work-guard` to isolate Git/report issues. | `/work-checkpoint test` reports a path. |
| Unexpected accumulated artifacts | Stop Pi, inspect, then archive or remove `.rpiv/artifacts/work-guard/` and `work-checkpoints/`. | Commands recreate directories on demand. |

`off` is an emergency bypass, not a default fix. It does not sandbox commands or undo prior side effects.
