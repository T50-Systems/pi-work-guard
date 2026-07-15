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

type ShellFlavor = "posix" | "powershell" | "cmd";

interface LexicalToken {
	kind: "word" | "operator";
	value: string;
	start: number;
	end: number;
	quoted: boolean;
}

interface CommandInvocation {
	name: string;
	args: LexicalToken[];
	precededByPipe: boolean;
	hasHeredoc: boolean;
}

interface LexicalContext {
	invocations: CommandInvocation[];
}

interface LexicalAnalysis {
	complete: boolean;
	contexts: LexicalContext[];
	invocations: CommandInvocation[];
	heredocs: number;
}

interface LexicalBudget {
	chars: number;
	tokens: number;
}

const MAX_LEXICAL_CHARS = 64_000;
const MAX_LEXICAL_TOKENS = 4_096;
const MAX_WRAPPER_DEPTH = 3;
const COMMAND_PREFIXES = new Set(["command", "env", "exec", "nohup", "sudo", "time"]);
const COMMAND_BOUNDARIES = new Set(["|", "||", "&&", ";", "&", "\n", "(", ")", "$("]);

function countMatches(value: string, pattern: RegExp): number {
	return value.match(pattern)?.length ?? 0;
}

function legacyHasBoundedOutput(command: string): boolean {
	return /\|\s*(head|tail|sed\s+-n|awk\s+)/i.test(command)
		|| /--stat\b/i.test(command)
		|| /\bSelect-Object\s+-(?:First|Last)\s+\d+/i.test(command)
		|| /\bGet-Content\b[^|;&]*(?:-TotalCount|-Tail)\s+\d+/i.test(command);
}

function legacyHasSearchLimit(command: string): boolean {
	return /(^|\s)(-m\s*\d+|--max-count(?:=|\s+)\d+|--count\b|--files\b)/i.test(command);
}

function legacyHasUnboundedFileRead(command: string): boolean {
	return /\b(cat|type|Get-Content|gc)\b\s+(?!<<)[^|;&]+/i.test(command);
}

function operatorAt(source: string, index: number, shell: ShellFlavor): string | undefined {
	const pair = source.slice(index, index + 2);
	if (pair === "&&" || pair === "||" || pair === "<<" || pair === ">>") return pair;
	if (shell === "posix" && pair === "$(") return pair;
	const char = source[index];
	if (shell === "cmd") return "|&()<>".includes(char) ? char : undefined;
	return "|;&()<>".includes(char) ? char : undefined;
}

function tokenize(source: string, shell: ShellFlavor, budget: LexicalBudget): { complete: boolean; tokens: LexicalToken[] } {
	if (source.length > budget.chars) return { complete: false, tokens: [] };
	budget.chars -= source.length;
	const tokens: LexicalToken[] = [];
	let wordStart = -1;
	let wordValue = "";
	let wordQuoted = false;
	let quote: "'" | "\"" | undefined;

	const pushToken = (token: LexicalToken): boolean => {
		if (budget.tokens < 1) return false;
		budget.tokens -= 1;
		tokens.push(token);
		return true;
	};
	const flushWord = (end: number): boolean => {
		if (wordStart < 0) return true;
		const pushed = pushToken({ kind: "word", value: wordValue, start: wordStart, end, quoted: wordQuoted });
		wordStart = -1;
		wordValue = "";
		wordQuoted = false;
		return pushed;
	};
	const startWord = (index: number): void => {
		if (wordStart < 0) wordStart = index;
	};

	for (let index = 0; index < source.length;) {
		const char = source[index];
		if (quote) {
			if (char === quote) {
				if (shell === "powershell" && quote === "'" && source[index + 1] === "'") {
					wordValue += "'";
					index += 2;
					continue;
				}
				quote = undefined;
				index += 1;
				continue;
			}
			const escape = shell === "powershell" ? "`" : shell === "posix" && quote === "\"" ? "\\" : undefined;
			if (escape && char === escape) {
				if (index + 1 >= source.length) return { complete: false, tokens };
				wordValue += source[index + 1];
				index += 2;
				continue;
			}
			wordValue += char;
			index += 1;
			continue;
		}

		const escape = shell === "posix" ? "\\" : shell === "powershell" ? "`" : "^";
		if (char === escape) {
			if (index + 1 >= source.length) return { complete: false, tokens };
			startWord(index);
			wordValue += source[index + 1];
			index += 2;
			continue;
		}
		const isQuote = char === "\"" || (char === "'" && shell !== "cmd");
		if (isQuote) {
			startWord(index);
			wordQuoted = true;
			quote = char as "'" | "\"";
			index += 1;
			continue;
		}
		if (char === "#" && shell !== "cmd" && wordStart < 0) {
			while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
			continue;
		}
		if (char === "\r" || char === "\n") {
			if (!flushWord(index)) return { complete: false, tokens };
			if (char === "\r" && source[index + 1] === "\n") index += 1;
			if (!pushToken({ kind: "operator", value: "\n", start: index, end: index + 1, quoted: false })) return { complete: false, tokens };
			index += 1;
			continue;
		}
		if (/\s/.test(char)) {
			if (!flushWord(index)) return { complete: false, tokens };
			index += 1;
			continue;
		}
		const operator = operatorAt(source, index, shell);
		if (operator) {
			if (!flushWord(index)) return { complete: false, tokens };
			if (!pushToken({ kind: "operator", value: operator, start: index, end: index + operator.length, quoted: false })) return { complete: false, tokens };
			index += operator.length;
			continue;
		}
		startWord(index);
		wordValue += char;
		index += 1;
	}

	if (quote || !flushWord(source.length)) return { complete: false, tokens };
	return { complete: true, tokens };
}

function commandName(value: string): string {
	const base = value.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
	return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

function isAssignment(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function invocationFrom(words: LexicalToken[], precededByPipe: boolean, hasHeredoc: boolean): CommandInvocation | undefined {
	let index = 0;
	while (index < words.length && isAssignment(words[index].value)) index += 1;
	for (let prefixCount = 0; index < words.length && prefixCount < 4; prefixCount += 1) {
		const prefix = commandName(words[index].value);
		if (!COMMAND_PREFIXES.has(prefix)) break;
		index += 1;
		while (index < words.length && (words[index].value.startsWith("-") || isAssignment(words[index].value))) index += 1;
	}
	if (index >= words.length) return undefined;
	return { name: commandName(words[index].value), args: words.slice(index + 1), precededByPipe, hasHeredoc };
}

function contextFrom(tokens: LexicalToken[]): LexicalContext {
	const invocations: CommandInvocation[] = [];
	let words: LexicalToken[] = [];
	let precededByPipe = false;
	let hasHeredoc = false;
	const flush = (): void => {
		const invocation = invocationFrom(words, precededByPipe, hasHeredoc);
		if (invocation && invocation.name !== "rem" && !invocation.name.startsWith("::")) invocations.push(invocation);
		words = [];
		hasHeredoc = false;
	};
	for (const token of tokens) {
		if (token.kind === "word") {
			words.push(token);
			continue;
		}
		if (token.value === "<<") hasHeredoc = true;
		if (!COMMAND_BOUNDARIES.has(token.value)) continue;
		flush();
		precededByPipe = token.value === "|";
	}
	flush();
	return { invocations };
}

function wrapperPayload(source: string, invocation: CommandInvocation): { shell: ShellFlavor; payload: string } | undefined {
	const wrapper = invocation.name;
	const switchName = wrapper === "cmd" ? "/c" : "-command";
	if (wrapper !== "cmd" && wrapper !== "pwsh" && wrapper !== "powershell") return undefined;
	const switchIndex = invocation.args.findIndex((token) => token.value.toLowerCase() === switchName);
	const payloadTokens = invocation.args.slice(switchIndex + 1);
	if (switchIndex < 0 || payloadTokens.length === 0) return undefined;
	const payload = payloadTokens.length === 1 && payloadTokens[0].quoted
		? payloadTokens[0].value
		: source.slice(payloadTokens[0].start, payloadTokens.at(-1)?.end);
	return { shell: wrapper === "cmd" ? "cmd" : "powershell", payload };
}

function analyzeLexically(command: string): LexicalAnalysis {
	const budget: LexicalBudget = { chars: MAX_LEXICAL_CHARS, tokens: MAX_LEXICAL_TOKENS };
	const contexts: LexicalContext[] = [];
	let complete = true;
	let rootHeredocs = 0;
	const visit = (source: string, shell: ShellFlavor, depth: number): void => {
		const result = tokenize(source, shell, budget);
		if (!result.complete) {
			complete = false;
			return;
		}
		if (depth === 0) rootHeredocs = result.tokens.filter((token) => token.kind === "operator" && token.value === "<<").length;
		const context = contextFrom(result.tokens);
		contexts.push(context);
		for (const invocation of context.invocations) {
			const wrapper = wrapperPayload(source, invocation);
			if (!wrapper) continue;
			if (depth >= MAX_WRAPPER_DEPTH) {
				complete = false;
				continue;
			}
			visit(wrapper.payload, wrapper.shell, depth + 1);
		}
	};
	visit(command, "posix", 0);
	return { complete, contexts, invocations: contexts.flatMap((context) => context.invocations), heredocs: rootHeredocs };
}

function hasNumberAfter(args: LexicalToken[], names: Set<string>): boolean {
	return args.some((arg, index) => names.has(arg.value.toLowerCase()) && /^\d+$/.test(args[index + 1]?.value ?? ""));
}

function hasPipelineBound(analysis: LexicalAnalysis): boolean {
	return analysis.invocations.some((invocation) => {
		if (!invocation.precededByPipe) return false;
		if (invocation.name === "head" || invocation.name === "tail" || invocation.name === "awk") return true;
		if (invocation.name === "sed") return invocation.args.some((arg) => /^-[^-]*n/.test(arg.value));
		return invocation.name === "select-object" && hasNumberAfter(invocation.args, new Set(["-first", "-last"]));
	});
}

function invocationHasBound(invocation: CommandInvocation): boolean {
	if (invocation.name === "git") return invocation.args.some((arg) => arg.value === "--stat" || arg.value.startsWith("--stat="));
	if (invocation.name === "get-content" || invocation.name === "gc") {
		return hasNumberAfter(invocation.args, new Set(["-totalcount", "-tail"]));
	}
	return false;
}

function invocationHasSearchLimit(invocation: CommandInvocation): boolean {
	return invocation.args.some((arg, index) => {
		const value = arg.value.toLowerCase();
		return /^-m\d+$/.test(value)
			|| (value === "-m" && /^\d+$/.test(invocation.args[index + 1]?.value ?? ""))
			|| /^--max-count=\d+$/.test(value)
			|| (value === "--max-count" && /^\d+$/.test(invocation.args[index + 1]?.value ?? ""))
			|| value === "--count"
			|| value === "--files";
	});
}

export function analyzeBashCommand(
	command: string,
	policy: CommandRiskPolicy = DEFAULT_COMMAND_RISK_POLICY,
): CommandRisk[] {
	const risks: CommandRisk[] = [];
	const lexical = analyzeLexically(command);
	const heredocs = lexical.complete ? lexical.heredocs : countMatches(command, /<<\s*['"]?[A-Za-z0-9_-]+['"]?/g);
	const pipelineBound = lexical.complete && hasPipelineBound(lexical);
	const gitDiffs = lexical.invocations.filter((invocation) => invocation.name === "git" && invocation.args[0]?.value.toLowerCase() === "diff");
	const fileReads = lexical.invocations.filter((invocation) => ["cat", "type", "get-content", "gc"].includes(invocation.name) && invocation.args.length > 0 && !invocation.hasHeredoc);
	const searches = lexical.invocations.filter((invocation) => ["find", "rg", "grep", "findstr", "select-string"].includes(invocation.name));

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

	const hasUnboundedGitDiff = lexical.complete
		? gitDiffs.some((invocation) => !pipelineBound && !invocationHasBound(invocation))
		: /\bgit\s+diff\b/.test(command) && !legacyHasBoundedOutput(command);
	if (hasUnboundedGitDiff) {
		risks.push({
			severity: "warning",
			code: "unbounded-git-diff",
			message: "Use git diff --stat first, or pipe diff output through sed/head.",
		});
	}

	const hasUnboundedFileRead = lexical.complete
		? fileReads.some((invocation) => !pipelineBound && !invocationHasBound(invocation))
		: legacyHasUnboundedFileRead(command) && !legacyHasBoundedOutput(command);
	if (hasUnboundedFileRead) {
		risks.push({
			severity: "warning",
			code: "possibly-unbounded-file-read",
			message: "Avoid unbounded cat/type on large files; use read ranges, sed -n, head, or module_report.",
		});
	}

	const hasUnboundedSearch = lexical.complete
		? searches.some((invocation) => !pipelineBound && !invocationHasSearchLimit(invocation))
		: /\b(find|rg|grep|findstr|Select-String)\b/i.test(command) && !legacyHasBoundedOutput(command) && !legacyHasSearchLimit(command);
	if (hasUnboundedSearch) {
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
