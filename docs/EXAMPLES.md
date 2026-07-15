# Examples and recipes

## Adopt a reviewed project policy

Copy one example into a trusted repository:

```bash
mkdir -p .pi
cp examples/work-guard-balanced.json .pi/work-guard.json
pi -e .
```

Run `/work-guard config`; the project path must appear in `sources` with `diagnostics: none`. Pi reads project configuration with the user's privileges, so review it before use.

To opt into 30-day whole-file event retention while keeping the byte budget, add both settings to the reviewed policy:

```json
{ "metricsMaxBytes": 1048576, "metricsMaxAgeDays": 30 }
```

Use `"metricsMaxAgeDays": null` (the default) to disable age pruning. Cleanup runs only when a metric append is queued; `/work-guard config` and `/work-budget` report but do not delete files.

## Strict CI or high-volume repository session

Start Pi for one process with strict mode without changing shared settings:

```bash
PI_WORK_GUARD_MODE=strict pi
```

On PowerShell:

```powershell
$env:PI_WORK_GUARD_MODE = "strict"
pi
Remove-Item Env:PI_WORK_GUARD_MODE
```

This only changes the Work Guard policy for that process; it does not make Pi a sandbox.

## Bounded command retries

| Blocked form | Bounded first retry |
| --- | --- |
| `git diff` | `git diff --stat` |
| `cat large.log` | `sed -n '1,200p' large.log` |
| `rg TODO` | `rg --max-count 50 TODO` |
| `find . -type f` | `find . -type f \| head -200` |

Inspect the summary before requesting another bounded range. Do not mechanically append `head` when early pipe termination would change a command's side effects.

## Long refactor checkpoint loop

```text
/work-phase start extract-config
/work-budget
/work-checkpoint config extracted; tests passing
/work-phase done npm test passing
```

A checkpoint records the note and concise repository report, not a patch or complete session transcript. Use Git for durable source history.

## Diagnose a typo safely

Given:

```json
{ "mode": "blok", "autoFixLineLimit": 0 }
```

`/work-guard config` reports both invalid values and keeps `mode: block` plus the default positive line limit. Correct the file, restart Pi, and verify `diagnostics: none` before relying on the override.
