import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { analyzeBashCommand, highestSeverity, type CommandRisk } from "../src/command-risk.ts";
import { buildGuardReport, formatGuardReport, writeCheckpoint } from "../src/repo-guard.ts";
import { configLines, loadConfig, type WorkGuardConfig, type WorkGuardMode } from "../src/work-guard-config.ts";

type WorkPhase = { name: string; startedAt: string; notes: string[] } | null;

interface BashInput {
	command: string;
}

interface WorkGuardMetric {
	timestamp: string;
	cwd: string;
	action: "warn" | "block" | "auto-fix";
	mode: WorkGuardMode;
	riskCodes: string[];
	commandLength: number;
}


function notify(ctx: { hasUI?: boolean; ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }, message: string, type: "info" | "warning" | "error" = "info") {
	if (ctx.hasUI !== false) ctx.ui.notify(message, type);
}

function getBashInput(event: unknown): BashInput | undefined {
	if (!event || typeof event !== "object") return undefined;
	const record = event as Record<string, unknown>;
	if (record.toolName !== "bash") return undefined;
	const input = record.input;
	if (!input || typeof input !== "object") return undefined;
	const command = (input as Record<string, unknown>).command;
	return typeof command === "string" ? (input as BashInput) : undefined;
}


function shouldBlockRisk(risk: CommandRisk, config: WorkGuardConfig): boolean {
	if (risk.severity === "block") return true;
	if (config.mode === "strict" && risk.severity === "warning") return true;
	if (risk.code === "unbounded-git-diff") return config.blockGitDiff;
	if (risk.code === "possibly-unbounded-file-read") return config.blockFileRead;
	if (risk.code === "search-output-budget") return config.blockSearch;
	return false;
}

function retryGuidanceFor(code: string): string {
	switch (code) {
		case "unbounded-git-diff":
			return "Retry with `git diff --stat` first, or bound output with `git diff | sed -n '1,200p'`.";
		case "possibly-unbounded-file-read":
			return "Retry with `head`, `sed -n`, `tail`, or Pi's read/module_report tools instead of unbounded cat/type.";
		case "search-output-budget":
			return "Retry with an explicit bound such as `head`, `sed -n`, `-m`, `--max-count`, `--count`, or `--files`.";
		case "command-too-large":
			return "Split the work into smaller commands or phases.";
		default:
			return "Adjust the command to keep output and memory use bounded, then retry.";
	}
}

function appendOutputBound(command: string, lineLimit: number): string {
	return `${command} | head -${lineLimit}`;
}

function autoFixCommand(command: string, risks: CommandRisk[], config: WorkGuardConfig): string | undefined {
	if (risks.some((risk) => risk.code === "command-too-large")) return undefined;
	if (risks.some((risk) => risk.code === "unbounded-git-diff")) return `${command} --stat`;
	if (risks.some((risk) => risk.code === "possibly-unbounded-file-read" || risk.code === "search-output-budget")) {
		return appendOutputBound(command, config.autoFixLineLimit);
	}
	return undefined;
}

function metricsDir(cwd: string): string {
	return path.join(cwd, ".rpiv", "artifacts", "work-guard");
}

async function recordMetric(cwd: string, metric: WorkGuardMetric): Promise<void> {
	try {
		const dir = metricsDir(cwd);
		await mkdir(dir, { recursive: true });
		await appendFile(path.join(dir, "events.jsonl"), `${JSON.stringify(metric)}\n`, "utf8");
	} catch {
		// Guard metrics must never break tool execution.
	}
}


export default function (pi: ExtensionAPI) {
	let phase: WorkPhase = null;
	let warningsThisSession = 0;
	let blockedThisSession = 0;
	let autoFixedThisSession = 0;

	pi.on("tool_call", async (event, ctx) => {
		const input = getBashInput(event);
		if (!input) return;

		const { config } = await loadConfig(ctx.cwd);
		if (config.mode === "off") return;

		const originalCommand = input.command;
		const risks = analyzeBashCommand(originalCommand);
		const severity = highestSeverity(risks);
		if (!severity) return;

		warningsThisSession += 1;
		const riskCodes = risks.map((risk) => risk.code);
		const summary = risks.map((risk) => `${risk.code}: ${risk.message}`).join(" | ");
		const guidance = risks.map((risk) => retryGuidanceFor(risk.code)).join(" ");
		const blockableRisks = risks.filter((risk) => shouldBlockRisk(risk, config));
		const shouldBlock = config.mode !== "warn" && blockableRisks.length > 0;

		if (shouldBlock && config.autoFix) {
			const fixedCommand = autoFixCommand(originalCommand, blockableRisks, config);
			if (fixedCommand && fixedCommand !== originalCommand) {
				input.command = fixedCommand;
				autoFixedThisSession += 1;
				notify(ctx, `WorkGuard auto-fixed risky bash command: ${summary}`, "warning");
				await recordMetric(ctx.cwd, {
					timestamp: new Date().toISOString(),
					cwd: ctx.cwd,
					action: "auto-fix",
					mode: config.mode,
					riskCodes,
					commandLength: originalCommand.length,
				});
				return;
			}
		}

		if (shouldBlock) {
			blockedThisSession += 1;
			notify(ctx, `WorkGuard blocked risky bash command: ${summary}`, "error");
			await recordMetric(ctx.cwd, {
				timestamp: new Date().toISOString(),
				cwd: ctx.cwd,
				action: "block",
				mode: config.mode,
				riskCodes,
				commandLength: originalCommand.length,
			});
			return { block: true, reason: `pi-work-guard: ${summary} ${guidance}` };
		}

		notify(ctx, `WorkGuard ${severity}: ${summary}`, severity === "warning" ? "warning" : "info");
		await recordMetric(ctx.cwd, {
			timestamp: new Date().toISOString(),
			cwd: ctx.cwd,
			action: "warn",
			mode: config.mode,
			riskCodes,
			commandLength: originalCommand.length,
		});
	});

	pi.registerCommand("work-guard", {
		description: "Run memory-safe workflow guard checks for the current repository",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "config") {
				const resolution = await loadConfig(ctx.cwd);
				ctx.ui.setWidget("pi-work-guard", configLines(resolution, ctx.cwd), { placement: "belowEditor" });
				notify(
					ctx,
					resolution.diagnostics.length === 0
						? "WorkGuard config displayed. No diagnostics."
						: `WorkGuard config has ${resolution.diagnostics.length} diagnostic(s); review the displayed sources.`,
					resolution.diagnostics.length === 0 ? "info" : "warning",
				);
				return;
			}

			const report = await buildGuardReport(ctx.cwd);
			const text = formatGuardReport(report);
			ctx.ui.setWidget("pi-work-guard", text.split("\n"), { placement: "belowEditor" });
			notify(ctx, report.fileSizeIssues.some((issue) => issue.severity === "error") ? "WorkGuard found file-size errors." : "WorkGuard report ready.", report.fileSizeIssues.some((issue) => issue.severity === "error") ? "error" : "info");
		},
	});

	pi.registerCommand("work-checkpoint", {
		description: "Write a compact progress checkpoint for safe continuation",
		handler: async (args, ctx) => {
			const filePath = await writeCheckpoint(ctx.cwd, args.trim());
			notify(ctx, `WorkGuard checkpoint written: ${filePath}`, "info");
		},
	});

	pi.registerCommand("work-phase", {
		description: "Start or finish a guarded work phase",
		handler: async (args, ctx) => {
			const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const note = rest.join(" ");
			if (action === "start") {
				phase = { name: note || "unnamed", startedAt: new Date().toISOString(), notes: [] };
				notify(ctx, `WorkGuard phase started: ${phase.name}`, "info");
				return;
			}
			if (action === "done") {
				const finished = phase;
				phase = null;
				notify(ctx, `WorkGuard phase done: ${finished?.name ?? "none"}${note ? ` — ${note}` : ""}`, "info");
				return;
			}
			notify(ctx, "Usage: /work-phase start <name> OR /work-phase done [note]", "warning");
		},
	});

	pi.registerCommand("work-budget", {
		description: "Show current WorkGuard phase and warning budget",
		handler: async (_args, ctx) => {
			const lines = [
				"pi-work-guard budget",
				`phase: ${phase ? `${phase.name} since ${phase.startedAt}` : "none"}`,
				`bash risk warnings this session: ${warningsThisSession}`,
				`bash commands blocked this session: ${blockedThisSession}`,
				`bash commands auto-fixed this session: ${autoFixedThisSession}`,
				`metrics: ${path.join(metricsDir(ctx.cwd), "events.jsonl")}`,
				"recommendation: bounded reads/searches are enforced; keep phases small, validate after each phase, checkpoint before broad refactors.",
			];
			ctx.ui.setWidget("pi-work-guard", lines, { placement: "belowEditor" });
			notify(ctx, "WorkGuard budget displayed.", "info");
		},
	});
}
