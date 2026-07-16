import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type WorkGuardMode = "off" | "warn" | "block" | "strict";

export interface WorkGuardConfig {
	mode: WorkGuardMode;
	autoFix: boolean;
	blockGitDiff: boolean;
	blockFileRead: boolean;
	blockSearch: boolean;
	autoFixLineLimit: number;
	enforceAgentBudget: boolean;
	maxAgentTurns: number;
	maxPlanAgentTurns: number;
	metricsEnabled: boolean;
	metricsMaxBytes: number;
	metricsMaxAgeDays: number | null;
}

export interface ConfigDiagnostic {
	source: string;
	message: string;
}

export interface ConfigResolution {
	config: WorkGuardConfig;
	sources: string[];
	diagnostics: ConfigDiagnostic[];
}

export interface LoadConfigOptions {
	home?: string;
	env?: NodeJS.ProcessEnv;
}

export const DEFAULT_CONFIG: WorkGuardConfig = {
	mode: "block",
	autoFix: false,
	blockGitDiff: true,
	blockFileRead: true,
	blockSearch: true,
	autoFixLineLimit: 200,
	enforceAgentBudget: true,
	maxAgentTurns: 25,
	maxPlanAgentTurns: 15,
	metricsEnabled: true,
	metricsMaxBytes: 1_048_576,
	metricsMaxAgeDays: null,
};

const CONFIG_KEYS = new Set<keyof WorkGuardConfig>([
	"mode",
	"autoFix",
	"blockGitDiff",
	"blockFileRead",
	"blockSearch",
	"autoFixLineLimit",
	"enforceAgentBudget",
	"maxAgentTurns",
	"maxPlanAgentTurns",
	"metricsEnabled",
	"metricsMaxBytes",
	"metricsMaxAgeDays",
]);

function normalizeMode(value: unknown): WorkGuardMode | undefined {
	return value === "off" || value === "warn" || value === "block" || value === "strict" ? value : undefined;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function mergeConfig(
	base: WorkGuardConfig,
	candidate: unknown,
	source: string,
	diagnostics: ConfigDiagnostic[],
): WorkGuardConfig {
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		diagnostics.push({ source, message: "configuration must be a JSON object; using lower-precedence values" });
		return base;
	}

	const value = candidate as Record<string, unknown>;
	for (const key of Object.keys(value)) {
		if (!CONFIG_KEYS.has(key as keyof WorkGuardConfig)) {
			diagnostics.push({ source, message: `unknown option \`${key}\` ignored` });
		}
	}

	const next = { ...base };
	if (value.mode !== undefined) {
		const mode = normalizeMode(value.mode);
		if (mode) next.mode = mode;
		else diagnostics.push({ source, message: "mode must be off, warn, block, or strict; using lower-precedence value" });
	}

	for (const key of ["autoFix", "blockGitDiff", "blockFileRead", "blockSearch", "enforceAgentBudget", "metricsEnabled"] as const) {
		if (value[key] === undefined) continue;
		if (typeof value[key] === "boolean") next[key] = value[key];
		else diagnostics.push({ source, message: `${key} must be boolean; using lower-precedence value` });
	}

	for (const key of ["autoFixLineLimit", "maxAgentTurns", "maxPlanAgentTurns", "metricsMaxBytes"] as const) {
		if (value[key] === undefined) continue;
		if (isPositiveInteger(value[key])) next[key] = value[key];
		else diagnostics.push({ source, message: `${key} must be a positive integer; using lower-precedence value` });
	}

	if (value.metricsMaxAgeDays !== undefined) {
		if (value.metricsMaxAgeDays === null || isPositiveInteger(value.metricsMaxAgeDays)) next.metricsMaxAgeDays = value.metricsMaxAgeDays;
		else diagnostics.push({ source, message: "metricsMaxAgeDays must be null or a positive integer; using lower-precedence value" });
	}
	return next;
}

async function readJson(filePath: string): Promise<{ exists: boolean; value?: unknown; error?: string }> {
	try {
		return { exists: true, value: JSON.parse(await readFile(filePath, "utf8")) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
		return { exists: true, error: error instanceof Error ? error.message : String(error) };
	}
}

export async function loadConfig(cwd: string, options: LoadConfigOptions = {}): Promise<ConfigResolution> {
	let config = { ...DEFAULT_CONFIG };
	const sources = ["built-in defaults"];
	const diagnostics: ConfigDiagnostic[] = [];
	const globalPath = path.join(options.home ?? homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "work-guard.json");

	const global = await readJson(globalPath);
	if (global.error) diagnostics.push({ source: globalPath, message: `invalid JSON: ${global.error}` });
	else if (global.value && typeof global.value === "object" && !Array.isArray(global.value)) {
		const workGuard = (global.value as { workGuard?: unknown }).workGuard;
		if (workGuard !== undefined) {
			sources.push(globalPath);
			config = mergeConfig(config, workGuard, globalPath, diagnostics);
		}
	}

	const project = await readJson(projectPath);
	if (project.exists) sources.push(projectPath);
	if (project.error) diagnostics.push({ source: projectPath, message: `invalid JSON: ${project.error}` });
	else if (project.exists) config = mergeConfig(config, project.value, projectPath, diagnostics);

	const environmentMode = (options.env ?? process.env).PI_WORK_GUARD_MODE;
	if (environmentMode !== undefined) {
		sources.push("PI_WORK_GUARD_MODE");
		const mode = normalizeMode(environmentMode);
		if (mode) config.mode = mode;
		else diagnostics.push({ source: "PI_WORK_GUARD_MODE", message: "must be off, warn, block, or strict; using lower-precedence value" });
	}

	return { config, sources, diagnostics };
}

export function configLines(resolution: ConfigResolution, cwd: string): string[] {
	const { config, sources, diagnostics } = resolution;
	return [
		"pi-work-guard config",
		`mode: ${config.mode}`,
		`autoFix: ${config.autoFix}`,
		`autoFixLineLimit: ${config.autoFixLineLimit}`,
		`blockGitDiff: ${config.blockGitDiff}`,
		`blockFileRead: ${config.blockFileRead}`,
		`blockSearch: ${config.blockSearch}`,
		`enforceAgentBudget: ${config.enforceAgentBudget}`,
		`maxAgentTurns: ${config.maxAgentTurns}`,
		`maxPlanAgentTurns: ${config.maxPlanAgentTurns}`,
		`metricsEnabled: ${config.metricsEnabled}`,
		`metricsMaxBytes: ${config.metricsMaxBytes}`,
		`metricsMaxAgeDays: ${config.metricsMaxAgeDays ?? "disabled"}`,
		`sources: ${sources.join(" -> ")}`,
		`diagnostics: ${diagnostics.length === 0 ? "none" : diagnostics.length}`,
		...diagnostics.map((diagnostic) => `- ${diagnostic.source}: ${diagnostic.message}`),
	];
}
