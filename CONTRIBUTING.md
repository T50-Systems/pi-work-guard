# Contributing

Thanks for improving pi-work-guard. Keep changes small, reviewable, and focused on bounded, memory-safe behavior.

## Prerequisites

- Node.js 22 or newer
- npm (the version bundled with Node.js is sufficient)
- Git
- Pi for interactive extension smoke tests

No credentials or environment variables are required for the automated test suite.

## Clone to verified change

```bash
git clone https://github.com/T50-Systems/pi-work-guard.git
cd pi-work-guard
npm ci
npm test
```

Create a topic branch before editing:

```bash
git switch -c <type>/<short-description>
```

Use a conventional type such as `docs/`, `fix/`, `feat/`, `test/`, or `chore/`. Keep commits scoped and use the repository's Conventional Commit style.

## Validation commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` / `npm run build` | Type-check extension and source TypeScript without emitting files. |
| `npm run test:unit` | Run the Node.js unit/integration harness. |
| `npm run coverage` | Emit text/LCOV/JSON metrics and enforce global plus critical-module floors. |
| `npm run check:file-size` | Enforce source file line budgets. |
| `npm run verify:release` | Check version, changelog, and package-content consistency; `-- --tag vX.Y.Z` also checks an exact tag. |
| `npm run benchmark:verify` | Run the expanded deterministic shell-classifier regression budget. |
| `npm test` | Run every required repository check in CI order. |
| `npm audit --audit-level=high` | Check production and development dependencies for high/critical advisories. |

This package is loaded by Pi directly from TypeScript, so `npm run build` is a no-emit compilation gate rather than an artifact build. Coverage floors are global lines/statements 75%, branches 65%, functions 75%; critical-module floors are encoded in `scripts/verify-coverage.mjs` and intentionally conservative.

## Continuous integration contract

Pull requests and pushes to `main` run Node.js 22 on both `ubuntu-latest` and `windows-latest`. Each matrix row has a 15-minute timeout and performs a locked `npm ci`, an explicit cross-shell fixture and event-log rotation pass, the complete `npm test` repository gate, coverage enforcement, `npm pack --dry-run`, and a high-severity dependency audit.

Coverage reports are retained for 14 days with platform-specific names (`coverage-node-22-ubuntu-latest` and `coverage-node-22-windows-latest`) so matrix uploads cannot collide. The CI workflow has read-only repository contents permission, does not consume secrets, and does not publish packages.

## Interactive smoke test

Run the checkout without installing it permanently:

```bash
pi -e .
```

Then verify:

1. `/work-guard config` displays expected values and sources with `diagnostics: none`.
2. `/work-guard` displays a repository report.
3. An unbounded `git diff` is blocked in `block` mode.
4. `git diff --stat` is allowed.

Use a disposable repository for commands that intentionally exercise blocking behavior.

## Test fixtures and temporary files

Tests create isolated temporary directories and repositories under the operating system temp directory. Shell-policy fixtures live in `tests/fixtures/command-risk-fixtures.mjs` and are also consumed by the benchmark. Runtime events and checkpoints under `.rpiv/artifacts/` are local artifacts and must not be committed.

## Security and privacy

- Never add API keys, credentials, `.env` files, Pi auth files, or captured command text to tests or commits.
- Metrics must remain privacy-minimized: risk metadata is acceptable, raw command text is not.
- Avoid new runtime dependencies unless the benefit and trust implications are clear.
- Follow [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Pull request checklist

- [ ] The change is narrow and its user impact is documented.
- [ ] New behavior has automated coverage or a documented manual check.
- [ ] `npm test` passes locally.
- [ ] `npm audit --audit-level=high` reports no high/critical vulnerabilities.
- [ ] Generated metrics, checkpoints, secrets, and unrelated files are excluded.
