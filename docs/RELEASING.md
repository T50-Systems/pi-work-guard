# Release process

Pi Work Guard uses Semantic Versioning and Keep a Changelog headings. Releases are maintainer-triggered; CI validates changes but does not publish automatically.

## Prepare

1. Start from a clean, current `main` and choose the SemVer impact.
2. Update `version` in `package.json` and `package-lock.json` together (`npm version <version> --no-git-tag-version` is acceptable).
3. Move relevant `[Unreleased]` entries in `CHANGELOG.md` under `## [x.y.z] - YYYY-MM-DD`; leave an empty `[Unreleased]` section.
4. Document behavior/config migration and recovery when applicable.
5. Run:

```bash
npm ci
npm test
npm run benchmark:verify
npm run verify:release
npm pack --dry-run
npm audit --audit-level=high
```

Review the dry-run package list for required source/docs and accidental artifacts or secrets.

## Tag and publish

After reviewed changes are merged and checks pass, create an annotated `vX.Y.Z` tag pointing to the release commit. Verify the tag version equals `package.json`, then create GitHub release notes from the matching changelog section. If distribution expands beyond GitHub installation, add a separately reviewed publishing procedure and least-privilege credentials; this repository does not currently define an npm publish step.

## Upgrade and rollback

Consumers should read the version's changelog, install the reviewed tag/commit, restart Pi, and run `/work-guard config` plus the quickstart smoke check. Roll back by reinstalling the previously reviewed tag. Configuration-only incompatibility can be isolated with a one-process `PI_WORK_GUARD_MODE`, but `off` should be temporary.

Never retag a released version. Correct release metadata with a new patch release.
