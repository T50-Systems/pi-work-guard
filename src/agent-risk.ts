import type { WorkGuardConfig } from "./work-guard-config.ts";

export interface AgentInput {
	subagent_type?: string;
	max_turns?: number;
}

export interface AgentRisk {
	code: "unbounded-agent" | "agent-turn-budget";
	message: string;
}

export type AgentClass = "plan" | "other";

export function agentClass(input: AgentInput): AgentClass {
	return input.subagent_type?.toLowerCase() === "plan" ? "plan" : "other";
}

export function agentTurnLimit(input: AgentInput, config: WorkGuardConfig): number {
	if (agentClass(input) === "plan") {
		return Math.min(config.maxPlanAgentTurns, config.maxAgentTurns);
	}
	return config.maxAgentTurns;
}

export function analyzeAgentInput(input: AgentInput, config: WorkGuardConfig): AgentRisk[] {
	if (!config.enforceAgentBudget) return [];
	const limit = agentTurnLimit(input, config);
	if (!Number.isInteger(input.max_turns) || (input.max_turns ?? 0) <= 0) {
		return [{
			code: "unbounded-agent",
			message: `Agent ${input.subagent_type ?? "unknown"} must set max_turns to a positive integer no greater than ${limit}.`,
		}];
	}
	if ((input.max_turns as number) > limit) {
		return [{
			code: "agent-turn-budget",
			message: `Agent ${input.subagent_type ?? "unknown"} requests ${input.max_turns} turns; configured maximum is ${limit}.`,
		}];
	}
	return [];
}
