import type { AgentType, AgentTypeInfo, SubAgentConfig, OrchestratorState } from '@pulse-ide/shared';
export type { AgentType, AgentTypeInfo, SubAgentConfig, OrchestratorState };
export declare const AGENT_TYPES: Record<AgentType, AgentTypeInfo>;
export declare class Orchestrator {
    private state;
    getState(): OrchestratorState;
    setTask(task: string): void;
    setPlan(plan: string): void;
    setPhase(phase: OrchestratorState['phase']): void;
    addSubagent(config: SubAgentConfig): void;
    updateSubagent(id: string, updates: Partial<SubAgentConfig>): void;
}
//# sourceMappingURL=orchestrator.d.ts.map