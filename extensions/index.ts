import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { analyzeBashCommand, highestSeverity } from "../src/command-risk.ts";
import { buildGuardReport, formatGuardReport, writeCheckpoint } from "../src/repo-guard.ts";

type WorkPhase = { name: string; startedAt: string; notes: string[] } | null;

function notify(ctx: { hasUI?: boolean; ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }, message: string, type: "info" | "warning" | "error" = "info") {
	if (ctx.hasUI !== false) ctx.ui.notify(message, type);
}

function getBashCommand(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const record = event as Record<string, unknown>;
	if (record.toolName !== "bash") return undefined;
	const input = record.input;
	if (!input || typeof input !== "object") return undefined;
	const command = (input as Record<string, unknown>).command;
	return typeof command === "string" ? command : undefined;
}

export default function (pi: ExtensionAPI) {
	let phase: WorkPhase = null;
	let warningsThisSession = 0;

	pi.on("tool_call", async (event, ctx) => {
		const command = getBashCommand(event);
		if (!command) return;

		const risks = analyzeBashCommand(command);
		const severity = highestSeverity(risks);
		if (!severity) return;

		warningsThisSession += 1;
		const summary = risks.map((risk) => `${risk.code}: ${risk.message}`).join(" | ");
		if (severity === "block") {
			notify(ctx, `WorkGuard blocked risky bash command: ${summary}`, "error");
			return { block: true, reason: `pi-work-guard: ${summary}` };
		}

		notify(ctx, `WorkGuard ${severity}: ${summary}`, severity === "warning" ? "warning" : "info");
	});

	pi.registerCommand("work-guard", {
		description: "Run memory-safe workflow guard checks for the current repository",
		handler: async (_args, ctx) => {
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
				"recommendation: keep phases small, validate after each phase, checkpoint before broad refactors.",
			];
			ctx.ui.setWidget("pi-work-guard", lines, { placement: "belowEditor" });
			notify(ctx, "WorkGuard budget displayed.", "info");
		},
	});
}
