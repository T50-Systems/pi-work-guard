import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import extension from "../extensions/index.ts";
import { analyzeBashCommand } from "../src/command-risk.ts";
import {
  malformedConservativeFixtures,
  quoteAwareRiskFixtures,
  quoteAwareSafeFixtures,
  riskFixtures,
  unsupportedCompositionFixtures,
} from "./fixtures/command-risk-fixtures.mjs";

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

  async function runToolCall(toolName, input) {
    return toolCallHandler({ toolName, input }, ctx);
  }

  async function runCommand(command) {
    const input = { command };
    const result = await runToolCall("bash", input);
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

  return { runCommand, runToolCall, runSlashCommand, readMetrics, notifications, widgets, cwd };
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

test("autoFix mutates eligible risky commands without logging command text", async () => {
  const { runCommand, readMetrics } = await createHarness({ autoFix: true, autoFixLineLimit: 50 });
  const originalCommand = "rg SUPER_SECRET_VALUE";

  const { result, input } = await runCommand(originalCommand);

  assert.equal(result, undefined);
  assert.equal(input.command, `${originalCommand} | head -50`);
  const metric = (await readMetrics()).at(-1);
  assert.equal(metric.action, "auto-fix");
  assert.equal(metric.commandLength, originalCommand.length);
  assert.equal(metric.originalCommand, undefined);
  assert.equal(metric.finalCommand, undefined);
});

test("blocks Agent calls without max_turns", async () => {
  const { runToolCall, notifications, readMetrics } = await createHarness();
  const input = { subagent_type: "Plan", description: "Broad plan" };

  const result = await runToolCall("Agent", input);

  assert.equal(result?.block, true);
  assert.match(result.reason, /explicit positive `max_turns`/);
  assert.equal(notifications.at(-1)?.type, "error");
  const metric = (await readMetrics()).at(-1);
  assert.equal(metric.toolName, "Agent");
  assert.equal(metric.agentClass, "plan");
  assert.equal(metric.commandLength, undefined);
  assert.deepEqual(metric.riskCodes, ["unbounded-agent"]);
  assert.equal(JSON.stringify(metric).includes("Broad plan"), false);
});

test("allows Agent calls within the configured turn budget", async () => {
  const { runToolCall } = await createHarness();

  assert.equal(await runToolCall("Agent", { subagent_type: "Plan", max_turns: 15 }), undefined);
  assert.equal(await runToolCall("Agent", { subagent_type: "Explore", max_turns: 25 }), undefined);
});

test("blocks Agent calls above the type-specific turn budget", async () => {
  const { runToolCall, readMetrics } = await createHarness({ maxAgentTurns: 30, maxPlanAgentTurns: 12 });

  const result = await runToolCall("Agent", { subagent_type: "Plan", max_turns: 13 });

  assert.equal(result?.block, true);
  assert.match(result.reason, /configured maximum is 12/);
  assert.deepEqual((await readMetrics()).at(-1).riskCodes, ["agent-turn-budget"]);
});

test("autoFix adds or clamps Agent max_turns", async () => {
  const { runToolCall, readMetrics } = await createHarness({ autoFix: true, maxAgentTurns: 20, maxPlanAgentTurns: 10 });
  const missing = { subagent_type: "Plan" };
  const excessive = { subagent_type: "general-purpose", max_turns: 100 };

  assert.equal(await runToolCall("Agent", missing), undefined);
  assert.equal(missing.max_turns, 10);
  assert.equal(await runToolCall("Agent", excessive), undefined);
  assert.equal(excessive.max_turns, 20);

  const metrics = await readMetrics();
  assert.equal(metrics.at(-2).effectiveMaxTurns, 10);
  assert.equal(metrics.at(-1).requestedMaxTurns, 100);
  assert.equal(metrics.at(-1).effectiveMaxTurns, 20);
});

test("warn mode reports unbounded Agent calls without blocking", async () => {
  const { runToolCall, notifications, readMetrics } = await createHarness({ mode: "warn" });
  const input = { subagent_type: "Plan" };

  assert.equal(await runToolCall("Agent", input), undefined);
  assert.equal(input.max_turns, undefined);
  assert.equal(notifications.at(-1)?.type, "warning");
  assert.equal((await readMetrics()).at(-1).action, "warn");
});

test("can disable Agent budget enforcement", async () => {
  const { runToolCall } = await createHarness({ enforceAgentBudget: false });

  assert.equal(await runToolCall("Agent", { subagent_type: "Plan" }), undefined);
});

test("block metrics omit potentially sensitive command text", async () => {
  const { runCommand, readMetrics } = await createHarness();

  await runCommand("grep API_TOKEN=secret-value .env");

  const metric = (await readMetrics()).at(-1);
  assert.equal(metric.action, "block");
  assert.equal(metric.originalCommand, undefined);
  assert.equal(JSON.stringify(metric).includes("secret-value"), false);
});

test("/work-guard config displays resolved sources and no diagnostics", async () => {
  const { runSlashCommand, widgets, notifications, cwd } = await createHarness({ mode: "strict", autoFix: true });

  await runSlashCommand("work-guard", "config");

  const lines = widgets.at(-1)?.lines ?? [];
  assert.ok(lines.includes("mode: strict"));
  assert.ok(lines.includes("autoFix: true"));
  assert.ok(lines.includes("metricsMaxAgeDays: disabled"));
  assert.ok(lines.includes("enforceAgentBudget: true"));
  assert.ok(lines.includes("maxAgentTurns: 25"));
  assert.ok(lines.includes("maxPlanAgentTurns: 15"));
  assert.ok(lines.some((line) => line.startsWith("sources: built-in defaults")));
  assert.ok(lines.includes("diagnostics: none"));
  assert.ok(lines.some((line) => line.includes(path.join(cwd, ".rpiv", "artifacts", "work-guard", "events.jsonl"))));
  assert.equal(notifications.at(-1)?.type, "info");
});

test("/work-guard config surfaces invalid overrides as warnings", async () => {
  const { runSlashCommand, widgets, notifications } = await createHarness({ mode: "blok", typoOption: true });

  await runSlashCommand("work-guard", "config");

  const lines = widgets.at(-1)?.lines ?? [];
  assert.ok(lines.includes("mode: block"));
  assert.ok(lines.includes("diagnostics: 2"));
  assert.ok(lines.some((line) => line.includes("unknown option `typoOption`")));
  assert.equal(notifications.at(-1)?.type, "warning");
});

for (const fixture of riskFixtures) {
  test(`${fixture.name} has focused mode and bounded-output regression coverage`, async () => {
    assert.ok(analyzeBashCommand(fixture.risky).some((risk) => risk.code === fixture.riskCode), `${fixture.name} risk code`);
    for (const [mode, expected] of Object.entries(fixture.expectationByMode)) {
      assert.equal(fixture.classificationByMode[mode].falsePositive, false);
      assert.equal(fixture.classificationByMode[mode].falseNegative, false);
      const harness = await createHarness({ mode });
      const risky = await harness.runCommand(fixture.risky);
      assert.equal(risky.result?.block === true ? "block" : "warn", expected, `${fixture.name} in ${mode}`);
      if (expected === "block") assert.match(risky.result.reason, /Retry|Adjust|explicit bound/);
      assert.equal((await harness.runCommand(fixture.bounded)).result, undefined, `${fixture.name} bounded form`);
    }
  });
}

test("quote-aware fixtures ignore literal and comment command text", async () => {
  const { runCommand } = await createHarness();
  for (const fixture of quoteAwareSafeFixtures) {
    assert.equal((await runCommand(fixture.command)).result, undefined, fixture.name);
    assert.deepEqual(analyzeBashCommand(fixture.command), [], fixture.name);
  }
});

test("quote-aware executable positions preserve risk codes and retry guidance", async () => {
  const { runCommand } = await createHarness();
  for (const fixture of quoteAwareRiskFixtures) {
    assert.ok(analyzeBashCommand(fixture.command).some((risk) => risk.code === fixture.riskCode), fixture.name);
    const { result } = await runCommand(fixture.command);
    assert.equal(result?.block, true, fixture.name);
    assert.match(result.reason, /Retry|explicit bound/, fixture.name);
  }
});

test("malformed lexical input falls back conservatively", async () => {
  const { runCommand } = await createHarness();
  for (const fixture of malformedConservativeFixtures) {
    assert.ok(analyzeBashCommand(fixture.command).some((risk) => risk.code === fixture.riskCode), fixture.name);
    assert.equal((await runCommand(fixture.command)).result?.block, true, fixture.name);
  }
});

test("cross-shell fixture auto-fix expectations are explicit and safe", async () => {
  for (const fixture of riskFixtures) {
    const { runCommand } = await createHarness({ autoFix: true });
    const { result, input } = await runCommand(fixture.risky);
    if (fixture.autoFix === "changed") {
      assert.equal(result, undefined, fixture.name);
      assert.notEqual(input.command, fixture.risky, fixture.name);
    } else {
      assert.equal(result?.block, true, fixture.name);
      assert.equal(input.command, fixture.risky, fixture.name);
    }
  }
});

test("unsupported shell compositions are blocked without unsafe auto-fix", async () => {
  for (const fixture of unsupportedCompositionFixtures) {
    const { runCommand } = await createHarness({ autoFix: true });
    const { result, input } = await runCommand(fixture.command);
    assert.equal(result?.block, true, `${fixture.name} should remain blocked`);
    assert.equal(input.command, fixture.command, `${fixture.name} must remain unchanged`);
    assert.match(result.reason, /Retry|explicit bound/);
  }
});

test("non-Bash tool calls bypass command interception", async () => {
  const { runToolCall, notifications } = await createHarness();
  assert.equal(await runToolCall("read", { path: "README.md" }), undefined);
  assert.equal(await runToolCall("write", { path: "out", content: "git diff" }), undefined);
  assert.equal(notifications.length, 0);
});

test("metric-write failure never interrupts command enforcement and is reported", async () => {
  const { cwd, runCommand, runSlashCommand, widgets } = await createHarness();
  await writeFile(path.join(cwd, ".rpiv"), "not-a-directory", "utf8");
  const { result } = await runCommand("git diff");
  assert.equal(result?.block, true);
  await runSlashCommand("work-budget");
  const lines = widgets.at(-1)?.lines ?? [];
  assert.ok(lines.some((line) => line.startsWith("metrics last write error:") && !line.endsWith("none")));
});

test("metric retention rotates only complete JSON Lines at the byte threshold", async () => {
  const { cwd, runCommand, runSlashCommand, widgets } = await createHarness({ metricsMaxBytes: 500, metricsMaxAgeDays: 30 });
  await Promise.all(Array.from({ length: 12 }, (_, index) => runCommand(index % 2 === 0 ? "git diff" : "cat README.md")));
  const dir = path.join(cwd, ".rpiv", "artifacts", "work-guard");
  for (const file of ["events.jsonl", "events.previous.jsonl"]) {
    const content = await readFile(path.join(dir, file), "utf8");
    for (const line of content.trim().split("\n")) assert.doesNotThrow(() => JSON.parse(line));
    assert.ok(Buffer.byteLength(content) <= 500);
    assert.equal(content.includes("git diff"), false);
  }
  await runSlashCommand("work-budget");
  assert.ok((widgets.at(-1)?.lines ?? []).some((line) => line.includes("one previous valid JSONL file retained")));
  assert.ok((widgets.at(-1)?.lines ?? []).some((line) => line.includes("metrics age retention: 30 days")));
  assert.ok((widgets.at(-1)?.lines ?? []).some((line) => line.startsWith("metrics last successful age prune: 20")));
});

test("disabled metrics create no event file and status reports disabled", async () => {
  const { cwd, runCommand, runSlashCommand, widgets } = await createHarness({ metricsEnabled: false });
  assert.equal((await runCommand("git diff")).result?.block, true);
  const eventPath = path.join(cwd, ".rpiv", "artifacts", "work-guard", "events.jsonl");
  await assert.rejects(readFile(eventPath, "utf8"), { code: "ENOENT" });
  await runSlashCommand("work-budget");
  assert.ok((widgets.at(-1)?.lines ?? []).includes("metrics: disabled"));
});
