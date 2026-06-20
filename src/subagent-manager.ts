import { Agent, AuditEntry } from './agent';
import { ToolRegistry } from './tool-registry';

import { config } from './config';

export interface SubAgent {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error' | 'killed';
  result?: string;
  history?: { role: string; content: string }[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export class SubAgentManager {
  private subAgents: Map<string, SubAgent> = new Map();
  private nextId = 1;

  createSubAgent(task: string, allowedTools?: string[]): SubAgent {
    const id = `sub_${this.nextId++}_${Date.now().toString(36)}`;
    const sub: SubAgent = {
      id,
      task,
      status: 'running',
      startedAt: Date.now(),
    };
    this.subAgents.set(id, sub);
    console.log(`🤖 Spawned sub-agent ${id}: ${task.substring(0, 60)}`);
    return sub;
  }

  getSubAgent(id: string): SubAgent | undefined {
    return this.subAgents.get(id);
  }

  listActive(): SubAgent[] {
    return Array.from(this.subAgents.values());
  }

  killSubAgent(id: string): boolean {
    const sub = this.subAgents.get(id);
    if (!sub) return false;
    sub.status = 'killed';
    sub.finishedAt = Date.now();
    sub.error = 'Aborted by user';
    console.log(`🛑 Killed sub-agent ${id}`);
    return true;
  }

  /** Abort all active sub-agents and clear the map */
  abortAll(): void {
    for (const sub of this.subAgents.values()) {
      if (sub.status === 'running') {
        sub.status = 'killed';
        sub.finishedAt = Date.now();
        sub.error = 'Aborted by user';
      }
    }
    this.subAgents.clear();
    console.log('🛑 All sub-agents aborted');
  }

  /** Remove completed/killed sub-agents older than maxAgeMs */
  cleanupOld(maxAgeMs: number = config.subagentMaxAgeMs): void {
    const now = Date.now();
    for (const [id, sub] of this.subAgents) {
      if (sub.finishedAt && now - sub.finishedAt > maxAgeMs) {
        this.subAgents.delete(id);
      }
    }
  }

  async runSubAgent(
    subAgent: SubAgent,
    instructions: string,
    parentApiKey: string,
    parentBaseURL: string,
    parentRegistry: ToolRegistry,
    allowedToolNames?: string[],
    onSubAgentUpdate?: (sub: SubAgent) => void,
    modelConfig?: { model?: string },
  ): Promise<string> {
    // Create a sub-registry with filtered tools
    const subRegistry = new ToolRegistry();
    const allToolNames = parentRegistry.getToolNames();
    const toolsToAllow = allowedToolNames && allowedToolNames.length > 0
      ? allToolNames.filter(t => allowedToolNames.includes(t))
      : ['read_file', 'list_files', 'get_current_file', 'search_code', 'run_terminal', 'write_file', 'edit_file', 'delete_file'];

    // We need to re-register the allowed tools on the sub-registry
    const toolsSchema = parentRegistry.getToolsSchema() as any[];
    const allowedSchemas = toolsSchema.filter((t: any) => toolsToAllow.includes(t.function.name));

    for (const toolDef of allowedSchemas) {
      subRegistry.register({
        name: toolDef.function.name,
        description: toolDef.function.description,
        parameters: toolDef.function.parameters,
        handler: this.createHandlerForTool(parentRegistry, toolDef.function.name),
      });
    }

    const subAgentInstance = new Agent(parentApiKey, parentBaseURL, subRegistry, {
      model: modelConfig?.model || '',
    });

    try {
      const result = await subAgentInstance.chat(instructions);

      subAgent.status = 'done';
      subAgent.result = result.response;
      subAgent.history = result.history.map(m => ({ role: m.role, content: (m.content || '').substring(0, 200) }));
      subAgent.finishedAt = Date.now();

      console.log(`✅ Sub-agent ${subAgent.id} completed in ${((subAgent.finishedAt - subAgent.startedAt) / 1000).toFixed(1)}s`);
      onSubAgentUpdate?.(subAgent);
      return result.response;
    } catch (err: unknown) {
      const error = err as Error;
      subAgent.status = 'error';
      subAgent.error = error.message;
      subAgent.finishedAt = Date.now();
      console.error(`❌ Sub-agent ${subAgent.id} failed: ${error.message}`);
      onSubAgentUpdate?.(subAgent);
      return `Sub-agent error: ${error.message}`;
    }
  }

  private createHandlerForTool(parentRegistry: ToolRegistry, toolName: string): (args: Record<string, unknown>) => Promise<string> {
    // Return a handler that delegates to the parent registry's execute
    // This is a closure that captures the parent registry
    return async (args: Record<string, unknown>): Promise<string> => {
      return parentRegistry.execute(toolName, args);
    };
  }
}
