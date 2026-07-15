import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getMetricStatus, metricStatusLines, metricsDir, metricsPath, recordMetric } from "../src/event-log.ts";
import { DEFAULT_CONFIG } from "../src/work-guard-config.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.parse("2026-07-15T12:00:00.000Z");

function config(overrides = {}) {
  return { ...DEFAULT_CONFIG, metricsMaxBytes: 100_000, metricsMaxAgeDays: 1, ...overrides };
}

function metric(cwd, index = 0) {
  return {
    timestamp: new Date(NOW + index).toISOString(),
    cwd,
    action: "block",
    mode: "block",
    riskCodes: ["unbounded-git-diff"],
    commandLength: 20 + index,
  };
}

async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-work-guard-event-log-"));
  const active = metricsPath(cwd);
  const previous = path.join(metricsDir(cwd), "events.previous.jsonl");
  await mkdir(metricsDir(cwd), { recursive: true });
  return { cwd, active, previous };
}

async function seed(filePath, label, mtime) {
  const content = `${JSON.stringify({ seed: label })}\n`;
  await writeFile(filePath, content, "utf8");
  await utimes(filePath, new Date(mtime), new Date(mtime));
  return content;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function jsonLines(filePath) {
  const content = await readFile(filePath, "utf8");
  assert.ok(content.endsWith("\n"), `${filePath} must end at a complete JSONL boundary`);
  return content.trim().split("\n").map((line) => JSON.parse(line));
}

test("disabled age retention leaves stale active and previous files intact", async () => {
  const { cwd, active, previous } = await fixture();
  const activeSeed = await seed(active, "active", NOW - 10 * DAY_MS);
  const previousSeed = await seed(previous, "previous", NOW - 10 * DAY_MS);

  await recordMetric(cwd, metric(cwd), config({ metricsMaxAgeDays: null }), { now: () => NOW });

  assert.ok((await readFile(active, "utf8")).startsWith(activeSeed));
  assert.equal(await readFile(previous, "utf8"), previousSeed);
  const status = await getMetricStatus(cwd, config({ metricsMaxAgeDays: null }));
  assert.equal(status.lastSuccessfulPrune, undefined);
  assert.ok(metricStatusLines(status).includes("metrics age retention: disabled"));
});

test("disabled metrics make a configured age policy inactive", async () => {
  const { cwd, active } = await fixture();
  const activeSeed = await seed(active, "stale-active", NOW - 10 * DAY_MS);
  const disabled = config({ metricsEnabled: false });

  await recordMetric(cwd, metric(cwd), disabled, { now: () => NOW });

  assert.equal(await readFile(active, "utf8"), activeSeed);
  const status = await getMetricStatus(cwd, disabled);
  assert.ok(metricStatusLines(status).includes("metrics age retention: 1 day configured; inactive while metrics are disabled"));
  assert.equal(status.lastSuccessfulPrune, undefined);
});

test("age retention removes a stale active file and keeps a fresh previous file whole", async () => {
  const { cwd, active, previous } = await fixture();
  await seed(active, "stale-active", NOW - 2 * DAY_MS);
  const previousSeed = await seed(previous, "fresh-previous", NOW - DAY_MS + 1_000);

  await recordMetric(cwd, metric(cwd), config(), { now: () => NOW });

  const activeLines = await jsonLines(active);
  assert.equal(activeLines.length, 1);
  assert.equal(activeLines[0].seed, undefined);
  assert.equal(await readFile(previous, "utf8"), previousSeed);
});

test("age retention keeps a fresh active file and removes a stale previous file", async () => {
  const { cwd, active, previous } = await fixture();
  await seed(active, "fresh-active", NOW - DAY_MS + 1_000);
  await seed(previous, "stale-previous", NOW - 2 * DAY_MS);

  await recordMetric(cwd, metric(cwd), config(), { now: () => NOW });

  const activeLines = await jsonLines(active);
  assert.equal(activeLines.length, 2);
  assert.equal(activeLines[0].seed, "fresh-active");
  assert.equal(await exists(previous), false);
});

test("mtime at the age cutoff is stale while a newer whole file is fresh", async () => {
  const stale = await fixture();
  await seed(stale.active, "boundary", NOW - DAY_MS);
  await recordMetric(stale.cwd, metric(stale.cwd), config(), { now: () => NOW });
  assert.equal((await jsonLines(stale.active)).some((line) => line.seed === "boundary"), false);

  const fresh = await fixture();
  await seed(fresh.active, "newer", NOW - DAY_MS + 1_000);
  await recordMetric(fresh.cwd, metric(fresh.cwd), config(), { now: () => NOW });
  assert.equal((await jsonLines(fresh.active))[0].seed, "newer");
});

test("future mtimes stay fresh and status uses the queued append clock", async () => {
  const { cwd, active } = await fixture();
  await seed(active, "future", NOW + DAY_MS);

  await recordMetric(cwd, metric(cwd), config(), { now: () => NOW });

  assert.equal((await jsonLines(active))[0].seed, "future");
  const status = await getMetricStatus(cwd, config());
  assert.equal(status.lastSuccessfulPrune, new Date(NOW).toISOString());
  assert.ok(metricStatusLines(status).includes(`metrics last successful age prune: ${new Date(NOW).toISOString()}`));
});

test("invalid clocks fail age cleanup safely without reporting a successful prune", async () => {
  const { cwd } = await fixture();

  await assert.doesNotReject(recordMetric(cwd, metric(cwd), config(), { now: () => Number.NaN }));

  const status = await getMetricStatus(cwd, config());
  assert.equal(status.lastSuccessfulPrune, undefined);
  assert.match(status.lastWriteError ?? "", /\(EINVAL\) metric write failed$/);
});

test("concurrent appends serialize cleanup and preserve byte and JSONL privacy boundaries", async () => {
  const { cwd, active, previous } = await fixture();
  await seed(previous, "stale-previous", NOW - 2 * DAY_MS);
  const retention = config({ metricsMaxBytes: 20_000 });

  await Promise.all(Array.from({ length: 40 }, (_, index) => recordMetric(cwd, metric(cwd, index), retention, { now: () => NOW })));

  assert.equal(await exists(previous), false);
  const content = await readFile(active, "utf8");
  assert.ok(Buffer.byteLength(content) <= retention.metricsMaxBytes);
  const lines = await jsonLines(active);
  assert.equal(lines.length, 40);
  for (const line of lines) {
    assert.deepEqual(Object.keys(line).sort(), ["action", "commandLength", "cwd", "mode", "riskCodes", "timestamp"]);
    assert.equal("command" in line || "originalCommand" in line || "finalCommand" in line, false);
  }
});

test("age cleanup filesystem failures remain best-effort and privacy-safe", async () => {
  const { cwd, active } = await fixture();
  await mkdir(active);
  await utimes(active, new Date(NOW - 2 * DAY_MS), new Date(NOW - 2 * DAY_MS));

  await assert.doesNotReject(recordMetric(cwd, metric(cwd), config(), { now: () => NOW }));

  const status = await getMetricStatus(cwd, config());
  assert.equal(status.lastSuccessfulPrune, undefined);
  assert.match(status.lastWriteError ?? "", /metric write failed$/);
  assert.equal((status.lastWriteError ?? "").includes(cwd), false);
});
