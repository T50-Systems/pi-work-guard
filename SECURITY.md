# Security Policy

## Supported versions

Security fixes are applied to the current `main` branch. Until a formal release cadence is established, users should update to the latest reviewed commit or release.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, tokens, private command output, or other sensitive data.

Use GitHub's private vulnerability reporting for this repository when available: **Security → Advisories → Report a vulnerability**. Include:

- affected version or commit;
- reproduction steps with secrets removed;
- expected and observed behavior;
- impact assessment;
- any proposed mitigation.

If private reporting is unavailable, open a minimal public issue asking maintainers for a private contact channel without disclosing vulnerability details.

## Threat model and data handling

Pi extensions execute with the current user's permissions. Only install this package from a source and revision you trust.

pi-work-guard reads:

- global Pi settings at `~/.pi/agent/settings.json`;
- project overrides at `.pi/work-guard.json`;
- Git metadata and tracked source files for repository reports.

It writes local metrics and checkpoints under `.rpiv/artifacts/`. Metrics deliberately omit command text and retain only risk metadata. The active event file has a default 1 MiB budget, rotates only at complete JSONL boundaries, and retains one previous file. Optional age retention is disabled by default and, when enabled, removes only whole active/previous files by filesystem `mtime`; it never parses or rewrites event lines. Both files remain internal operational data. Set `metricsEnabled: false` where even minimized local telemetry is inappropriate.

## Dependency and CI controls

- The lockfile is installed with `npm ci` in CI.
- CI runs type checks, tests, coverage floors, file-size enforcement, and `npm audit --audit-level=high`.
- Dependabot checks npm and GitHub Actions dependencies weekly.
- Pull-request CI is read-only and credential-free. The tag-only release workflow has only `contents: write`, verifies the exact version/changelog first, and never publishes to npm.
