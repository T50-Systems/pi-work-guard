import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkGuardConfig, WorkGuardMode } from "./work-guard-config.ts";

export interface WorkGuardMetric {
	timestamp: string;
	cwd: string;
	action: "warn" | "block" | "auto-fix";
	mode: WorkGuardMode;
	riskCodes: string[];
	commandLength: number;
}

export interface MetricStatus {
	enabled: boolean;
	filePath: string;
	currentBytes: number;
	maxBytes: number;
	rotatedFilePath: string;
	lastWriteError?: string;
}

const lastWriteErrors = new Map<string, string>();
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

function safeError(error: unknown): string {
	const code = (error as NodeJS.ErrnoException)?.code;
	return `${new Date().toISOString()} ${code ? `(${code}) ` : ""}metric write failed`;
}

async function writeMetric(cwd: string, metric: WorkGuardMetric, config: WorkGuardConfig): Promise<void> {
	try {
		const line = `${JSON.stringify(metric)}\n`;
		const lineBytes = Buffer.byteLength(line, "utf8");
		if (lineBytes > config.metricsMaxBytes) throw Object.assign(new Error("metric exceeds retention budget"), { code: "E2BIG" });

		const dir = metricsDir(cwd);
		const currentPath = metricsPath(cwd);
		const previousPath = rotatedMetricsPath(cwd);
		await mkdir(dir, { recursive: true });
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

export async function recordMetric(cwd: string, metric: WorkGuardMetric, config: WorkGuardConfig): Promise<void> {
	if (!config.metricsEnabled) return;
	const previous = writeQueues.get(cwd) ?? Promise.resolve();
	const current = previous.then(() => writeMetric(cwd, metric, config));
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
		lastWriteError: lastWriteErrors.get(cwd),
	};
}

export function metricStatusLines(status: MetricStatus): string[] {
	return [
		`metrics: ${status.enabled ? "enabled" : "disabled"}`,
		`metrics file: ${status.filePath}`,
		`metrics retention: ${status.currentBytes}/${status.maxBytes} bytes; one previous valid JSONL file retained`,
		`metrics last write error: ${status.lastWriteError ?? "none"}`,
	];
}
