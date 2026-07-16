import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkGuardConfig, WorkGuardMode } from "./work-guard-config.ts";

export interface WorkGuardMetric {
	timestamp: string;
	cwd: string;
	action: "warn" | "block" | "auto-fix";
	mode: WorkGuardMode;
	riskCodes: string[];
	commandLength?: number;
	toolName?: "Agent";
	agentClass?: "plan" | "other";
	requestedMaxTurns?: number;
	effectiveMaxTurns?: number;
}

export interface EventLogOptions {
	now?: () => number;
}

export interface MetricStatus {
	enabled: boolean;
	filePath: string;
	currentBytes: number;
	maxBytes: number;
	rotatedFilePath: string;
	maxAgeDays: number | null;
	lastSuccessfulPrune?: string;
	lastWriteError?: string;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const lastWriteErrors = new Map<string, string>();
const lastSuccessfulPrunes = new Map<string, string>();
const writeQueues = new Map<string, Promise<void>>();

export function metricsDir(cwd: string): string {
	return path.join(cwd, ".rpiv", "artifacts", "work-guard");
}

export function metricsPath(cwd: string): string {
	return path.join(metricsDir(cwd), "events.jsonl");
}

function rotatedMetricsPath(cwd: string): string {
	return path.join(metricsDir(cwd), "events.previous.jsonl");
}

async function fileSize(filePath: string): Promise<number> {
	try {
		return (await stat(filePath)).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
		throw error;
	}
}

function clockNow(options: EventLogOptions): number {
	const now = options.now?.() ?? Date.now();
	if (!Number.isFinite(now)) throw Object.assign(new Error("invalid retention clock"), { code: "EINVAL" });
	return now;
}

async function pruneExpiredFiles(cwd: string, maxAgeDays: number, now: number): Promise<void> {
	const cutoff = now - maxAgeDays * MILLISECONDS_PER_DAY;
	for (const filePath of [metricsPath(cwd), rotatedMetricsPath(cwd)]) {
		try {
			const file = await stat(filePath);
			if (file.mtimeMs <= cutoff) await rm(filePath, { force: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	lastSuccessfulPrunes.set(cwd, new Date(now).toISOString());
}

function safeError(error: unknown): string {
	const code = (error as NodeJS.ErrnoException)?.code;
	return `${new Date().toISOString()} ${code ? `(${code}) ` : ""}metric write failed`;
}

async function writeMetric(cwd: string, metric: WorkGuardMetric, config: WorkGuardConfig, options: EventLogOptions): Promise<void> {
	try {
		const line = `${JSON.stringify(metric)}\n`;
		const lineBytes = Buffer.byteLength(line, "utf8");
		if (lineBytes > config.metricsMaxBytes) throw Object.assign(new Error("metric exceeds retention budget"), { code: "E2BIG" });

		const dir = metricsDir(cwd);
		const currentPath = metricsPath(cwd);
		const previousPath = rotatedMetricsPath(cwd);
		await mkdir(dir, { recursive: true });
		if (config.metricsMaxAgeDays !== null) await pruneExpiredFiles(cwd, config.metricsMaxAgeDays, clockNow(options));
		const currentBytes = await fileSize(currentPath);
		if (currentBytes > 0 && currentBytes + lineBytes > config.metricsMaxBytes) {
			await rm(previousPath, { force: true });
			await rename(currentPath, previousPath);
		}
		await appendFile(currentPath, line, "utf8");
		lastWriteErrors.delete(cwd);
	} catch (error) {
		lastWriteErrors.set(cwd, safeError(error));
		// Metrics are best-effort and must never interrupt command enforcement.
	}
}

export async function recordMetric(
	cwd: string,
	metric: WorkGuardMetric,
	config: WorkGuardConfig,
	options: EventLogOptions = {},
): Promise<void> {
	if (!config.metricsEnabled) return;
	const previous = writeQueues.get(cwd) ?? Promise.resolve();
	const current = previous.then(() => writeMetric(cwd, metric, config, options));
	writeQueues.set(cwd, current);
	await current;
	if (writeQueues.get(cwd) === current) writeQueues.delete(cwd);
}

export async function getMetricStatus(cwd: string, config: WorkGuardConfig): Promise<MetricStatus> {
	const filePath = metricsPath(cwd);
	let currentBytes = 0;
	try {
		currentBytes = await fileSize(filePath);
	} catch (error) {
		lastWriteErrors.set(cwd, safeError(error));
	}
	return {
		enabled: config.metricsEnabled,
		filePath,
		currentBytes,
		maxBytes: config.metricsMaxBytes,
		rotatedFilePath: rotatedMetricsPath(cwd),
		maxAgeDays: config.metricsMaxAgeDays,
		lastSuccessfulPrune: lastSuccessfulPrunes.get(cwd),
		lastWriteError: lastWriteErrors.get(cwd),
	};
}

function agePolicyStatus(status: MetricStatus): string {
	if (status.maxAgeDays === null) return "disabled";
	const duration = `${status.maxAgeDays} day${status.maxAgeDays === 1 ? "" : "s"}`;
	return status.enabled
		? `${duration}; whole files pruned by mtime`
		: `${duration} configured; inactive while metrics are disabled`;
}

export function metricStatusLines(status: MetricStatus): string[] {
	const agePolicy = agePolicyStatus(status);
	return [
		`metrics: ${status.enabled ? "enabled" : "disabled"}`,
		`metrics file: ${status.filePath}`,
		`metrics retention: ${status.currentBytes}/${status.maxBytes} bytes; one previous valid JSONL file retained`,
		`metrics age retention: ${agePolicy}`,
		`metrics last successful age prune: ${status.lastSuccessfulPrune ?? "none"}`,
		`metrics last write error: ${status.lastWriteError ?? "none"}`,
	];
}
