# pi-work-guard

Memory-safe workflow guard for Pi.

## Features

- Warns before risky/high-output bash commands.
- Provides `/work-guard` to inspect repository size/diff risk.
- Provides `/work-checkpoint` to write a resumable checkpoint file.
- Provides `/work-phase` to mark current work phase.
- Ships `npm run check:file-size` for enforcing file-size budgets.

## Install

```bash
pi install .
```

## Commands

```text
/work-guard
/work-checkpoint [note]
/work-phase start <name>
/work-phase done [note]
/work-budget
```
