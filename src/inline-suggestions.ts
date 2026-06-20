// src/inline-suggestions.ts
// Inline Suggestions — Ghost text completion (like Copilot)
// Provides real-time code suggestions as the user types

import * as vscode from 'vscode';
import { Agent } from './agent';

import { config } from './config';

export class InlineSuggestionProvider implements vscode.InlineCompletionItemProvider {
  private agent: Agent | null = null;
  private enabled: boolean = true;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number = config.inlineDebounceMs;
  private pendingAbort: AbortController | null = null;
  private lastRequestId: number = 0;

  setAgent(agent: Agent | null) { this.agent = agent; }
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  isEnabled(): boolean { return this.enabled; }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (!this.enabled || !this.agent) return null;

    // Cancel any in-flight request
    if (this.pendingAbort) {
      this.pendingAbort.abort();
      this.pendingAbort = null;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    const requestId = ++this.lastRequestId;

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) { resolve(null); return; }

        // Create an abort controller for this specific request
        const abort = new AbortController();
        this.pendingAbort = abort;

        try {
          const suggestion = await this.getSuggestion(document, position, abort.signal);
          // Only resolve if this is still the latest request
          if (requestId !== this.lastRequestId || abort.signal.aborted) {
            resolve(null);
            return;
          }
          if (suggestion) {
            resolve([new vscode.InlineCompletionItem(suggestion, new vscode.Range(position, position))]);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        } finally {
          if (this.pendingAbort === abort) this.pendingAbort = null;
        }
      }, this.debounceMs);
    });
  }

  private async getSuggestion(document: vscode.TextDocument, position: vscode.Position, signal: AbortSignal): Promise<string | null> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const beforeCursor = text.substring(Math.max(0, offset - 500), offset);
    const afterCursor = text.substring(offset, Math.min(text.length, offset + 100));

    const prompt = `Complete the following code. Return ONLY the completion text, no explanation, no markdown.

File: ${document.fileName}
Language: ${document.languageId}

// ... (before cursor)
${beforeCursor}
// ... (cursor here)
${afterCursor}
// ... (after cursor)

Completion:`;

    try {
      if (!this.agent) return null;
      // Check abort before making the call
      if (signal.aborted) return null;
      const response = await this.agent.callLLM(
        [{ role: 'user', content: prompt }],
        []
      );
      // Check abort after the call
      if (signal.aborted) return null;

      const completion = response?.choices?.[0]?.message?.content?.trim();
      if (completion && completion.length > 0 && completion.length < 1000) {
        let cleaned = completion;
        if (cleaned.startsWith('```')) {
          const lines = cleaned.split('\n');
          cleaned = lines.slice(1, -1).join('\n');
        }
        return cleaned;
      }
    } catch { /* fail silently */ }

    return null;
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}
