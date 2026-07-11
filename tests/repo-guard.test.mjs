import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildGuardReport, formatGuardReport, writeCheckpoint } from "../src/repo-guard.ts";

const execFileAsync = promisify(execFile);

async function createRepository() {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-work-guard-repo-"));
  await execFileAsync("git", ["init"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd });
  await writeFile(path.join(cwd, "large.ts"), Array.from({ length: 451 }, (_, index) => `export const line${index} = ${index};`).join("\n"), "utf8");
  await execFileAsync("git", ["add", "large.ts"], { cwd });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd });
  return cwd;
}

test("repository report remains bounded and summarizes tracked file issues", async () => {
  const cwd = await createRepository();
  await writeFile(path.join(cwd, "large.ts"), `${await readFile(path.join(cwd, "large.ts"), "utf8")}\nconst secret = \"DO_NOT_REPORT_RAW_DIFF\";\n`, "utf8");

  const report = await buildGuardReport(cwd);
  assert.deepEqual(report.fileSizeIssues, [{ path: "large.ts", lines: 453, severity: "warning" }]);
  assert.match(report.status, /large\.ts/);
  assert.match(report.diffStat, /large\.ts/);
  assert.equal(report.diffStat.includes("DO_NOT_REPORT_RAW_DIFF"), false);
  assert.ok(Buffer.byteLength(report.diffStat) < 2_000);
  assert.match(formatGuardReport(report), /WARNING large\.ts: 453 lines/);
});

test("checkpoint writes a compact report and caller note", async () => {
  const cwd = await createRepository();
  const filePath = await writeCheckpoint(cwd, "continue with focused validation");
  const content = await readFile(filePath, "utf8");
  assert.match(filePath, /\.rpiv[\\/]artifacts[\\/]work-checkpoints/);
  assert.match(content, /# Pi Work Checkpoint/);
  assert.match(content, /continue with focused validation/);
  assert.match(content, /git status:\nclean/);
});

test("repository report degrades safely outside a Git repository", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-work-guard-no-repo-"));
  const report = await buildGuardReport(cwd);
  assert.deepEqual(report, { fileSizeIssues: [], diffStat: "", status: "" });
});
