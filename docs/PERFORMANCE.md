# Performance baseline

## Scope

The hot path unique to Pi Work Guard is synchronous command-risk classification. Configuration reads and metric writes are asynchronous per risky tool call; repository reports and checkpoints are user-invoked. The baseline measures `analyzeBashCommand` over the shared deterministic corpus covering POSIX shell, PowerShell, cmd.exe, pipelines, redirections, subshells, chaining, allowed bounds, and oversized input.

## Reproduce

Use Node.js 22 or newer from a clean checkout:

```bash
npm ci
npm run benchmark
npm run benchmark:verify
```

For a longer sample:

```bash
node scripts/benchmark.mjs --iterations=1000000 --verify
```

The script performs a bounded warm-up, uses a deterministic round-robin fixture, reports Node/platform/iterations, and prints machine-readable JSON. It performs no network or repository I/O during measurement.

## Budget

The regression floor is **1,000 classifications per second**. This intentionally broad CI-safe floor detects algorithmic or accidental I/O regressions rather than micro-optimizing regular expressions. `npm run benchmark:verify` exits nonzero below it.

Record comparison results with the commit, CPU/runner, operating system, Node version, command, and JSON output. Compare like-for-like environments; elapsed time from different machines is not a release claim.

## Optimization triggers

Investigate when the verification floor fails consistently, classification appears in a Pi profile, the fixture no longer represents policy, or a new risk adds input-size-dependent backtracking. Prefer bounded patterns and pure helpers. Do not cache raw command strings because that expands memory use and privacy exposure.
