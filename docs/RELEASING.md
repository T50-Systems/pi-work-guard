# Release process

Pi Work Guard uses Semantic Versioning and Keep a Changelog headings. Pull-request CI is credential-free. Pushing a reviewed `vX.Y.Z` tag triggers the tag-only GitHub release workflow; it verifies and packages but never publishes to npm.

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

## Tag and create the GitHub release

After reviewed changes are merged and checks pass, create and push an annotated `vX.Y.Z` tag pointing to the release commit. `.github/workflows/release.yml` installs the lockfile, fails unless the tag exactly matches `package.json` and its dated changelog heading, runs `npm test`, performs the high-severity audit and package dry run, then creates or updates the GitHub Release from that reviewed changelog section. The job has only `contents: write`; there is no npm publish step or package-registry credential.

## Retry and rollback

If verification fails, do not move or reuse the failed tag. Delete the remote/local tag only when no GitHub Release was created and the tag is known to be unpublished, fix the release commit, then create a new reviewed tag. If a release object exists but its workflow was interrupted after verification, rerun the failed job; creation/update is idempotent for the same verified tag.

Never retag a released version. Correct released code or metadata with a new patch version. Consumers roll back by reinstalling the previously reviewed tag, restarting Pi, and checking `/work-guard config`; a one-process `PI_WORK_GUARD_MODE` can isolate configuration incompatibility, but `off` should be temporary.
