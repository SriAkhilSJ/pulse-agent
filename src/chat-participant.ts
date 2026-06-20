// src/chat-participant.ts
// PulseCode Chat Participant — Native @PulseCode agent in VS Code chat panel
// Like Cursor's @Cursor / Windsurf's @Windsurf

import * as vscode from 'vscode';
import { Agent, ToolStep } from './agent';

export class PulseCodeChatParticipant {
  private agent: Agent | null = null;
  private sessionId = '';

  constructor(agent: Agent) {
    this.agent = agent;
    this.sessionId = 'pulse-' + Date.now().toString(36);
  }

  async handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (!this.agent) {
      stream.markdown('PulseCode AI agent is not initialized.');
      return;
    }

    const query = request.prompt;
    if (!query.trim()) {
      stream.markdown('What would you like me to help with?');
      return;
    }

    // Send progress
    stream.push(new vscode.ChatResponseProgressPart('Thinking...'));

    try {
      // Stream tool steps as they happen
      const onToolStep = (step: ToolStep) => {
        if (step.status === 'running') {
          stream.push(new vscode.ChatResponseProgressPart(
            this.formatToolStep(step)
          ));
        } else if (step.status === 'done' && step.result) {
          // Show file diffs inline
          if (step.toolName === 'edit_file' || step.toolName === 'write_file') {
            const filePath = step.toolArgs['file_path'] as string;
            if (filePath) {
              const uri = vscode.Uri.file(filePath);
              stream.push(new vscode.ChatResponseReferencePart(uri));
            }
          }
        }
      };

      this.agent.setOnToolStepCallback(onToolStep);

      const result = await this.agent.chat(query);

      // Stream the final response
      stream.markdown(result.response || 'Task complete.');

    } catch (err) {
      stream.markdown('**Error:** ' + (err as Error).message);
    }
  }

  private formatToolStep(step: ToolStep): string {
    const name = step.toolName.replace(/_/g, ' ');
    const path = step.toolArgs['file_path'] as string || step.toolArgs['path'] as string || '';
    const shortPath = path ? ' `' + path.split('/').pop() + '`' : '';
    return name + shortPath;
  }
}
