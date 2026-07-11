#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const summary = JSON.parse(await readFile(new URL("../coverage/coverage-summary.json", import.meta.url), "utf8"));
const metrics = ["lines", "branches", "functions", "statements"];
const floors = {
  total: { lines: 75, branches: 65, functions: 75, statements: 75 },
  "src/command-risk.ts": { lines: 85, branches: 75, functions: 85, statements: 85 },
  "src/repo-guard.ts": { lines: 80, branches: 70, functions: 80, statements: 80 },
  "src/event-log.ts": { lines: 80, branches: 65, functions: 80, statements: 80 },
};
const failures = [];

function entryFor(name) {
  if (name === "total") return summary.total;
  return Object.entries(summary).find(([file]) => path.normalize(file).replaceAll("\\", "/").endsWith(name))?.[1];
}

for (const [name, thresholds] of Object.entries(floors)) {
  const entry = entryFor(name);
  if (!entry) {
    failures.push(`${name}: missing from coverage summary`);
    continue;
  }
  for (const metric of metrics) {
    const actual = entry[metric].pct;
    const expected = thresholds[metric];
    if (actual < expected) failures.push(`${name} ${metric}: ${actual}% < ${expected}%`);
  }
}

if (failures.length > 0) {
  console.error("coverage verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("coverage verification ok: global and critical-module floors met");
