import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FileSizeIssue {
	path: string;
	lines: number;
	severity: "warning" | "error";
}

export interface GuardReport {
	fileSizeIssues: FileSizeIssue[];
	diffStat: string;
	status: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 2_000_000 });
		return stdout.trim();
	} catch {
		return "";
	}
}

async function trackedFiles(cwd: string): Promise<string[]> {
	const output = await git(cwd, ["ls-files"]);
	return output.split(/\r?\n/).filter(Boolean);
}

export async function countLines(filePath: string): Promise<number> {
	const content = await readFile(filePath, "utf8");
	if (!content) return 0;
	return content.split(/\r?\n/).length;
}

export async function checkFileSizes(
	cwd: string,
	options: { maxLines?: number; warnLines?: number } = {},
): Promise<FileSizeIssue[]> {
	const maxLines = options.maxLines ?? 500;
	const warnLines = options.warnLines ?? 450;
	const files = (await trackedFiles(cwd)).filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file));
	const issues: FileSizeIssue[] = [];
	for (const file of files) {
		if (file.includes("node_modules/")) continue;
		const lines = await countLines(path.join(cwd, file));
		if (lines > maxLines) issues.push({ path: file, lines, severity: "error" });
		else if (lines > warnLines) issues.push({ path: file, lines, severity: "warning" });
	}
	return issues;
}

export async function buildGuardReport(cwd: string): Promise<GuardReport> {
	const [fileSizeIssues, diffStat, status] = await Promise.all([
		checkFileSizes(cwd),
		git(cwd, ["diff", "--stat"]),
		git(cwd, ["status", "--short"]),
	]);
	return { fileSizeIssues, diffStat, status };
}

export function formatGuardReport(report: GuardReport): string {
	const lines = ["pi-work-guard report", ""];
	if (report.fileSizeIssues.length === 0) lines.push("file-size: ok");
	else {
		lines.push("file-size:");
		for (const issue of report.fileSizeIssues) {
			lines.push(`- ${issue.severity.toUpperCase()} ${issue.path}: ${issue.lines} lines`);
		}
	}
	lines.push("", "git status:", report.status || "clean");
	lines.push("", "diff stat:", report.diffStat || "no unstaged diff");
	return lines.join("\n");
}

export async function writeCheckpoint(cwd: string, note: string): Promise<string> {
	const report = await buildGuardReport(cwd);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const dir = path.join(cwd, ".rpiv", "artifacts", "work-checkpoints");
	await mkdir(dir, { recursive: true });
	const filePath = path.join(dir, `${stamp}.md`);
	const body = [
		"# Pi Work Checkpoint",
		"",
		`Created: ${new Date().toISOString()}`,
		`CWD: ${cwd}`,
		"",
		"## Note",
		"",
		note || "(none)",
		"",
		"## Guard Report",
		"",
		"```text",
		formatGuardReport(report),
		"```",
		"",
	].join("\n");
	await writeFile(filePath, body, "utf8");
	return filePath;
}
