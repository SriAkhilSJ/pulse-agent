// src/tools/agent-tools.ts
import { Agent } from '../agent';
import { ToolRegistry } from '../tool-registry';
import { defineTool } from '../tool-registry';

export interface SpawnAgentResult {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

const activeSubAgents = new Map<string, SpawnAgentResult>();
let subAgentCounter = 0;

export const spawnAgentTool = defineTool(
  'spawn_agent',
  'Spawn a sub-agent to handle a task in parallel',
  {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      instructions: { type: 'string', description: 'Detailed instructions for the sub-agent' },
    },
    required: ['task', 'instructions'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const task = args.task as string;
    const instructions = args.instructions as string;
    if (!task || !instructions) throw new Error('spawn_agent requires "task" + "instructions"');
    const id = 'sub_' + (++subAgentCounter) + '_' + Date.now().toString(36);
    const result: SpawnAgentResult = { id, task, status: 'running' };
    activeSubAgents.set(id, result);
    return 'Spawned sub-agent ' + id + ': ' + task.substring(0, 60) + '\nUse get_subagent_result with agentId="' + id + '" to check status.';
  }
);

export const getSubagentResultTool = defineTool(
  'get_subagent_result',
  'Get the result of a spawned sub-agent',
  {
    type: 'object',
    properties: { agent_id: { type: 'string', description: 'Sub-agent ID from spawn_agent response' } },
    required: ['agent_id'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const agentId = args.agentId as string;
    if (!agentId) throw new Error('get_subagent_result requires "agentId"');
    const sub = activeSubAgents.get(agentId);
    if (!sub) return 'Sub-agent ' + agentId + ' not found';
    if (sub.status === 'running') return 'Sub-agent ' + agentId + ' is still running...';
    if (sub.status === 'error') return 'Sub-agent ' + agentId + ' failed: ' + sub.error;
    return 'Sub-agent ' + agentId + ' completed:\n' + sub.result;
  }
);

export function registerSubAgentResult(id: string, result: SpawnAgentResult): void {
  activeSubAgents.set(id, result);
}

export function getActiveSubAgents(): SpawnAgentResult[] {
  return Array.from(activeSubAgents.values());
}

export const executePlanTool = defineTool(
  'execute_plan',
  'Execute a multi-step plan via the orchestrator',
  {
    type: 'object',
    properties: { plan: { type: 'string', description: 'Plan to execute' } },
    required: ['plan'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const plan = args.plan as string;
    if (!plan) throw new Error('execute_plan requires "plan"');
    // Note: This is a simplified version. The full version needs apiKey, baseURL, registry, modelConfig
    // which are not available in the args. The actual implementation is in the Orchestrator.
    return 'Plan received. Use the orchestrator to execute: ' + plan.substring(0, 100);
  }
);
