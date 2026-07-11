#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { analyzeBashCommand } from "../src/command-risk.ts";

const args = new Set(process.argv.slice(2));
const iterationsArg = process.argv.find((arg) => arg.startsWith("--iterations="));
const iterations = Number(iterationsArg?.split("=")[1] ?? 100_000);
const minimumOpsPerSecond = 1_000;

if (!Number.isSafeInteger(iterations) || iterations < 1_000) {
  console.error("--iterations must be a safe integer of at least 1000");
  process.exit(2);
}

const commands = [
  "git diff",
  "git diff --stat",
  "rg TODO src",
  "rg --max-count 20 TODO src",
  "cat package.json",
  "cat package.json | head -40",
  "find . -type f",
  "grep -m 10 warning events.jsonl",
  `${"x".repeat(8_001)}`,
  "printf safe",
];

function run(count) {
  let riskCount = 0;
  for (let index = 0; index < count; index += 1) {
    riskCount += analyzeBashCommand(commands[index % commands.length]).length;
  }
  return riskCount;
}

run(Math.min(iterations, 10_000));
const started = performance.now();
const riskCount = run(iterations);
const elapsedMs = performance.now() - started;
const opsPerSecond = Math.round(iterations / (elapsedMs / 1_000));
const result = {
  benchmark: "command-risk-classification",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  iterations,
  fixtureCommands: commands.length,
  riskCount,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  opsPerSecond,
  minimumOpsPerSecond,
};

console.log(JSON.stringify(result, null, 2));
if (args.has("--verify") && opsPerSecond < minimumOpsPerSecond) {
  console.error(`benchmark budget failed: ${opsPerSecond} ops/s < ${minimumOpsPerSecond} ops/s`);
  process.exit(1);
}
