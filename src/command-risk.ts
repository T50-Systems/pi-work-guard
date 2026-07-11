export type RiskSeverity = "info" | "warning" | "block";

export interface CommandRisk {
	severity: RiskSeverity;
	code: string;
	message: string;
}

export interface CommandRiskPolicy {
	maxCommandChars: number;
	maxHeredocs: number;
	blockCommandChars: number;
}

export const DEFAULT_COMMAND_RISK_POLICY: CommandRiskPolicy = {
	maxCommandChars: 8_000,
	blockCommandChars: 30_000,
	maxHeredocs: 3,
};

function countMatches(value: string, pattern: RegExp): number {
	return value.match(pattern)?.length ?? 0;
}

function hasBoundedOutput(command: string): boolean {
	return /\|\s*(head|tail|sed\s+-n|awk\s+)/i.test(command)
		|| /--stat\b/i.test(command)
		|| /\bSelect-Object\s+-(?:First|Last)\s+\d+/i.test(command)
		|| /\bGet-Content\b[^|;&]*(?:-TotalCount|-Tail)\s+\d+/i.test(command);
}

function hasSearchLimit(command: string): boolean {
	return /(^|\s)(-m\s*\d+|--max-count(?:=|\s+)\d+|--count\b|--files\b)/i.test(command);
}

function hasUnboundedFileRead(command: string): boolean {
	return /\b(cat|type|Get-Content|gc)\b\s+(?!<<)[^|;&]+/i.test(command);
}

export function analyzeBashCommand(
	command: string,
	policy: CommandRiskPolicy = DEFAULT_COMMAND_RISK_POLICY,
): CommandRisk[] {
	const risks: CommandRisk[] = [];
	const heredocs = countMatches(command, /<<\s*['"]?[A-Za-z0-9_-]+['"]?/g);

	if (command.length > policy.blockCommandChars) {
		risks.push({
			severity: "block",
			code: "command-too-large",
			message: `Command is ${command.length.toLocaleString()} chars; split into smaller phases before running.`,
		});
	} else if (command.length > policy.maxCommandChars) {
		risks.push({
			severity: "warning",
			code: "command-large",
			message: `Command is ${command.length.toLocaleString()} chars; consider splitting it.`,
		});
	}

	if (heredocs > policy.maxHeredocs) {
		risks.push({
			severity: "warning",
			code: "many-heredocs",
			message: `Command contains ${heredocs} heredocs; write files in smaller batches.`,
		});
	}

	if (/\bgit\s+diff\b/.test(command) && !hasBoundedOutput(command)) {
		risks.push({
			severity: "warning",
			code: "unbounded-git-diff",
			message: "Use git diff --stat first, or pipe diff output through sed/head.",
		});
	}

	if (hasUnboundedFileRead(command) && !hasBoundedOutput(command)) {
		risks.push({
			severity: "warning",
			code: "possibly-unbounded-file-read",
			message: "Avoid unbounded cat/type on large files; use read ranges, sed -n, head, or module_report.",
		});
	}

	if (/\b(find|rg|grep|findstr|Select-String)\b/i.test(command) && !hasBoundedOutput(command) && !hasSearchLimit(command)) {
		risks.push({
			severity: "info",
			code: "search-output-budget",
			message: "Search command has no explicit output bound; consider head/sed, Select-Object, or a result limit.",
		});
	}

	return risks;
}

export function highestSeverity(risks: CommandRisk[]): RiskSeverity | undefined {
	if (risks.some((risk) => risk.severity === "block")) return "block";
	if (risks.some((risk) => risk.severity === "warning")) return "warning";
	if (risks.length > 0) return "info";
	return undefined;
}
