# Changelog

All notable changes are documented here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-07-16

### Added

- Product vision, measurable maintenance targets, architecture boundaries, operations/recovery guidance, examples, roadmap milestones, and a documented release process.
- Reproducible command-classification benchmark with a CI-safe verification budget.
- Configuration source and validation diagnostics, including safe fallback tests.
- Release metadata verification for version, changelog, and package contents.
- Contributor onboarding, CI validation, Dependabot, and security guidance.
- Coverage reporting with enforced global and critical-module floors, direct repository/checkpoint/failure-path tests, and CI artifacts.
- Cross-shell risk fixtures for POSIX, PowerShell, cmd.exe, and unsupported shell composition, shared with the benchmark.
- Size-bounded privacy-preserving event-log rotation and retention/error status.
- Disabled-by-default whole-file event age retention with mtime, clock, queue, status, and best-effort failure semantics.
- Tag-gated, least-privilege GitHub Release automation sourced from reviewed changelog notes.
- Cross-platform Node.js 22 CI on Ubuntu and Windows with explicit shell/rotation checks, package dry-run, high-severity audit, and platform-specific coverage artifacts.
- Explicit Agent `max_turns` enforcement with configurable general and Plan budgets, warn/block/auto-fix behavior, and privacy-minimized metrics.

### Changed

- Risk metrics omit raw and rewritten command text to preserve the privacy contract.
- Auto-fix now leaves pipelines, redirections, subshells, command chains, PowerShell, and cmd.exe forms unchanged.

## [0.2.0] - 2026-07-06

### Added

- Configurable command guard modes, auto-fix behavior, repository reports, checkpoints, phase/budget commands, metrics, and file-size checks.

## [0.1.0] - 2026-07-03

### Added

- Initial Pi Work Guard extension and MIT license.
