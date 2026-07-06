import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import extension from "../extensions/index.ts";

async function createHarness(config = {}) {
  let toolCallHandler;
  const commands = new Map();
  const notifications = [];
  const widgets = [];
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-work-guard-test-"));
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await writeFile(path.join(cwd, ".pi", "work-guard.json"), JSON.stringify({ mode: "block", autoFix: false, ...config }), "utf8");

  extension({
    on(eventName, handler) {
      if (eventName === "tool_call") toolCallHandler = handler;
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
  });

  assert.equal(typeof toolCallHandler, "function", "extension should register a tool_call handler");

  const ctx = {
    hasUI: true,
    cwd,
    ui: {
      notify(message, type = "info") {
        notifications.push({ message, type });
      },
      setWidget(name, lines, options) {
        widgets.push({ name, lines, options });
      },
    },
  };

  async function runCommand(command) {
    const input = { command };
    const result = await toolCallHandler({ toolName: "bash", input }, ctx);
    return { result, input };
  }

  async function runSlashCommand(name, args = "") {
    const command = commands.get(name);
    assert.ok(command, `/${name} should be registered`);
    return command.handler(args, ctx);
  }

  async function readMetrics() {
    const content = await readFile(path.join(cwd, ".rpiv", "artifacts", "work-guard", "events.jsonl"), "utf8");
    return content.trim().split("\n").map((line) => JSON.parse(line));
  }

  return { runCommand, runSlashCommand, readMetrics, notifications, widgets, cwd };
}

test("blocks unbounded git diff with retry guidance", async () => {
  const { runCommand, notifications } = await createHarness();

  const { result } = await runCommand("git diff");

  assert.equal(result?.block, true);
  assert.match(result.reason, /pi-work-guard/);
  assert.match(result.reason, /git diff --stat/);
  assert.equal(notifications.at(-1)?.type, "error");
});

test("allows bounded git diff", async () => {
  const { runCommand } = await createHarness();

  const { result } = await runCommand("git diff --stat");

  assert.equal(result, undefined);
});

test("blocks unbounded cat/type reads with retry guidance", async () => {
  const { runCommand } = await createHarness();

  const cat = await runCommand("cat package.json");
  const type = await runCommand("type package.json");

  assert.equal(cat.result?.block, true);
  assert.match(cat.result.reason, /read\/module_report/);
  assert.equal(type.result?.block, true);
  assert.match(type.result.reason, /read\/module_report/);
});

test("allows bounded cat/type reads", async () => {
  const { runCommand } = await createHarness();

  assert.equal((await runCommand("cat package.json | head -40")).result, undefined);
  assert.equal((await runCommand("type package.json | sed -n '1,40p'")).result, undefined);
});

test("blocks unbounded searches with explicit bound guidance", async () => {
  const { runCommand } = await createHarness();

  for (const command of ["rg TODO", "grep TODO README.md", "find . -type f"]) {
    const { result } = await runCommand(command);
    assert.equal(result?.block, true, `${command} should be blocked`);
    assert.match(result.reason, /explicit bound/);
  }
});

test("allows bounded searches", async () => {
  const { runCommand } = await createHarness();

  assert.equal((await runCommand("rg TODO | head -20")).result, undefined);
  assert.equal((await runCommand("grep -m 20 TODO README.md")).result, undefined);
  assert.equal((await runCommand("find . -type f | sed -n '1,40p'")).result, undefined);
  assert.equal((await runCommand("rg --files")).result, undefined);
});

test("keeps low-risk warnings non-blocking", async () => {
  const { runCommand, notifications } = await createHarness();
  const command = Array.from({ length: 4 }, (_, index) => `cat <<EOF${index}\nvalue\nEOF${index}`).join("\n");

  const { result } = await runCommand(command);

  assert.equal(result, undefined);
  assert.equal(notifications.at(-1)?.type, "warning");
  assert.match(notifications.at(-1)?.message, /many-heredocs/);
});

test("warn mode records but does not block", async () => {
  const { runCommand, readMetrics, notifications } = await createHarness({ mode: "warn" });

  const { result } = await runCommand("git diff");

  assert.equal(result, undefined);
  assert.equal(notifications.at(-1)?.type, "warning");
  assert.equal((await readMetrics()).at(-1).action, "warn");
});

test("autoFix mutates eligible risky commands instead of blocking", async () => {
  const { runCommand, readMetrics } = await createHarness({ autoFix: true, autoFixLineLimit: 50 });

  const { result, input } = await runCommand("rg TODO");

  assert.equal(result, undefined);
  assert.equal(input.command, "rg TODO | head -50");
  const metric = (await readMetrics()).at(-1);
  assert.equal(metric.action, "auto-fix");
  assert.equal(metric.finalCommand, "rg TODO | head -50");
});

test("/work-guard config displays active config and metrics path", async () => {
  const { runSlashCommand, widgets, cwd } = await createHarness({ mode: "strict", autoFix: true });

  await runSlashCommand("work-guard", "config");

  const lines = widgets.at(-1)?.lines ?? [];
  assert.ok(lines.includes("mode: strict"));
  assert.ok(lines.includes("autoFix: true"));
  assert.ok(lines.some((line) => line.includes(path.join(cwd, ".rpiv", "artifacts", "work-guard", "events.jsonl"))));
});
