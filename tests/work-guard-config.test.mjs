import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { configLines, loadConfig } from "../src/work-guard-config.ts";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-work-guard-config-"));
  const home = path.join(root, "home");
  const cwd = path.join(root, "repo");
  await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  return { home, cwd };
}

test("config precedence is defaults, global, project, then environment", async () => {
  const { home, cwd } = await fixture();
  await writeFile(
    path.join(home, ".pi", "agent", "settings.json"),
    JSON.stringify({ workGuard: { mode: "warn", autoFix: true, autoFixLineLimit: 75, metricsMaxAgeDays: 30 } }),
  );
  await writeFile(
    path.join(cwd, ".pi", "work-guard.json"),
    JSON.stringify({ mode: "block", autoFixLineLimit: 25, blockSearch: false, metricsMaxAgeDays: 7 }),
  );

  const resolution = await loadConfig(cwd, { home, env: { PI_WORK_GUARD_MODE: "strict" } });

  assert.deepEqual(resolution.config, {
    mode: "strict",
    autoFix: true,
    blockGitDiff: true,
    blockFileRead: true,
    blockSearch: false,
    autoFixLineLimit: 25,
    metricsEnabled: true,
    metricsMaxBytes: 1_048_576,
    metricsMaxAgeDays: 7,
  });
  assert.equal(resolution.diagnostics.length, 0);
  assert.deepEqual(resolution.sources.map((source) => path.basename(source)), [
    "built-in defaults",
    "settings.json",
    "work-guard.json",
    "PI_WORK_GUARD_MODE",
  ]);
});

test("null age retention disables an inherited maximum age", async () => {
  const { home, cwd } = await fixture();
  await writeFile(
    path.join(home, ".pi", "agent", "settings.json"),
    JSON.stringify({ workGuard: { metricsMaxAgeDays: 30 } }),
  );
  await writeFile(path.join(cwd, ".pi", "work-guard.json"), JSON.stringify({ metricsMaxAgeDays: null }));

  const resolution = await loadConfig(cwd, { home, env: {} });

  assert.equal(resolution.config.metricsMaxAgeDays, null);
  assert.equal(resolution.diagnostics.length, 0);
});

test("invalid project values retain safe lower-precedence values and emit diagnostics", async () => {
  const { home, cwd } = await fixture();
  await writeFile(
    path.join(cwd, ".pi", "work-guard.json"),
    JSON.stringify({ mode: "dangerous", autoFix: "yes", autoFixLineLimit: 0, metricsEnabled: "yes", metricsMaxBytes: 0, metricsMaxAgeDays: 0, typoOption: true }),
  );

  const resolution = await loadConfig(cwd, { home, env: {} });

  assert.equal(resolution.config.mode, "block");
  assert.equal(resolution.config.autoFix, false);
  assert.equal(resolution.config.autoFixLineLimit, 200);
  assert.equal(resolution.config.metricsEnabled, true);
  assert.equal(resolution.config.metricsMaxBytes, 1_048_576);
  assert.equal(resolution.config.metricsMaxAgeDays, null);
  assert.deepEqual(
    resolution.diagnostics.map(({ message }) => message),
    [
      "unknown option `typoOption` ignored",
      "mode must be off, warn, block, or strict; using lower-precedence value",
      "autoFix must be boolean; using lower-precedence value",
      "metricsEnabled must be boolean; using lower-precedence value",
      "autoFixLineLimit must be a positive integer; using lower-precedence value",
      "metricsMaxBytes must be a positive integer; using lower-precedence value",
      "metricsMaxAgeDays must be null or a positive integer; using lower-precedence value",
    ],
  );
  assert.ok(configLines(resolution, cwd).some((line) => line.includes("diagnostics: 7")));
});

test("malformed project JSON is reported without disabling the guard", async () => {
  const { home, cwd } = await fixture();
  await writeFile(path.join(cwd, ".pi", "work-guard.json"), "{ invalid json");

  const resolution = await loadConfig(cwd, { home, env: {} });

  assert.equal(resolution.config.mode, "block");
  assert.equal(resolution.diagnostics.length, 1);
  assert.match(resolution.diagnostics[0].message, /invalid JSON/);
});

test("checked-in configuration examples resolve without diagnostics", async () => {
  for (const example of ["work-guard-balanced.json", "work-guard-strict.json"]) {
    const { home, cwd } = await fixture();
    const content = await readFile(new URL(`../examples/${example}`, import.meta.url), "utf8");
    await writeFile(path.join(cwd, ".pi", "work-guard.json"), content);

    const resolution = await loadConfig(cwd, { home, env: {} });

    assert.equal(resolution.diagnostics.length, 0, example);
  }
});
