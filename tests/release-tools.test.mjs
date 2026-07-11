import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("release verifier accepts the exact package tag", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/verify-release.mjs", "--tag", "v0.2.0"], { cwd });
  assert.match(stdout, /release verification ok/);
});

test("release verifier rejects a mismatched tag before release creation", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/verify-release.mjs", "--tag", "v9.9.9"], { cwd }),
    (error) => error.code === 1 && /must exactly match package version/.test(error.stderr),
  );
});

test("release notes are extracted from the matching reviewed changelog section", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/release-notes.mjs", "v0.2.0"], { cwd });
  assert.match(stdout, /^# v0\.2\.0 — 2026-07-06/m);
  assert.match(stdout, /Configurable command guard modes/);
  assert.equal(stdout.includes("[0.1.0]"), false);
});

test("tag workflow is least-privilege, verifies before release, and never publishes", async () => {
  const workflow = await readFile(path.join(cwd, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /npm run verify:release -- --tag/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.ok(workflow.indexOf("verify:release") < workflow.indexOf("gh release"));
  assert.equal(/npm publish|NODE_AUTH_TOKEN|id-token: write/.test(workflow), false);
});
