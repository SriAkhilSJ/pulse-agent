// src/memory-system.ts
// Bridge between Memory storage and agent system prompt injection.
// Saves durable facts and user profile, injects them into every turn.

import { Memory, MemoryEntry } from './memory';

import { config } from './config';

export interface LlmConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export class MemorySystem {
  private memory: Memory;
  private llmConfig: LlmConfig | null = null;

  constructor(memory: Memory) {
    this.memory = memory;
  }

  /** Set LLM config from extension.ts (already-resolved provider). Eliminates duplicate env resolution. */
  setLlmConfig(config: LlmConfig | null): void {
    this.llmConfig = config;
  }

  saveFact(content: string, category: MemoryEntry['category'] = 'fact'): void {
    this.memory.add({ content, timestamp: Date.now(), category });
  }

  removeFact(content: string): void {
    this.memory.remove(content);
  }

  clearAll(): void {
    this.memory.clear();
  }

  setProfile(profile: string): void {
    this.memory.setProfile(profile);
  }

  getProfile(): string {
    return this.memory.getProfile();
  }

  getMemoryBlock(): string {
    return this.memory.formatForSystemPrompt();
  }

  getProfileBlock(): string {
    const profile = this.memory.getProfile();
    if (!profile) return '';
    return '## User Profile\n' + profile + '\n';
  }

  // Fact extraction -- called after each agent response (0 extra API calls for regex path)
  // If regex finds nothing, fires LLM extraction as fire-and-forget (+1 API call only when needed)
  extractAndSaveFacts(userMessage: string, assistantResponse: string): void {
    const found = this.extractRegexFacts(userMessage, assistantResponse);
    if (!found) {
      this.extractFactsWithLLM(userMessage, assistantResponse);
    }
  }

  // Returns true if any fact was found/extracted
  private extractRegexFacts(userMessage: string, assistantResponse: string): boolean {
    let found = false;

    const nameMatch = userMessage.match(/(?:my name is|i'm|i am|call me|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      this.memory.add({ content: 'User\'s name is ' + name, timestamp: Date.now(), category: 'user-preference' });
      found = true;
    }

    const preferencePatterns = [
      { pattern: /i prefer\s+(.+)/i, template: 'User prefers $1' },
      { pattern: /i like\s+(.+)/i, template: 'User likes $1' },
      { pattern: /i want\s+(.+)/i, template: 'User wants $1' },
      { pattern: /always\s+(.+)/i, template: 'Always $1' },
      { pattern: /never\s+(.+)/i, template: 'Never $1' },
      { pattern: /use\s+(.+?)\s+for\s+(.+)/i, template: 'Use $1 for $2' },
    ];

    for (const { pattern, template } of preferencePatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        let fact = template;
        for (let i = 1; i < match.length; i++) {
          fact = fact.replace('$' + i, match[i].trim());
        }
        const existing = this.memory.getAll();
        if (!existing.find(e => e.content.toLowerCase() === fact.toLowerCase())) {
          this.memory.add({ content: fact, timestamp: Date.now(), category: 'user-preference' });
          found = true;
        }
      }
    }

    const envPatterns = [
      /installed\s+(.+)/i,
      /using\s+(.+?)\s+version/i,
      /project\s+uses\s+(.+)/i,
      /created\s+(.+)/i,
    ];

    for (const pattern of envPatterns) {
      const match = assistantResponse.match(pattern);
      if (match && match[0].length < 100) {
        const fact = match[0].trim();
        const existing = this.memory.getAll();
        if (!existing.find(e => e.content === fact)) {
          this.memory.add({ content: fact, timestamp: Date.now(), category: 'environment' });
          found = true;
        }
      }
    }

    const projectPatterns = [
      /(?:the|this)\s+project\s+uses\s+(.+)/i,
      /(?:the|this)\s+codebase\s+uses\s+(.+)/i,
      /(?:built|created|made)\s+with\s+(.+)/i,
    ];

    for (const pattern of projectPatterns) {
      const match = assistantResponse.match(pattern);
      if (match && match[0].length < 100) {
        const fact = match[0].trim();
        const existing = this.memory.getAll();
        if (!existing.find(e => e.content === fact)) {
          this.memory.add({ content: fact, timestamp: Date.now(), category: 'environment' });
          found = true;
        }
      }
    }

    const correctionPatterns = [
      /(?:no|wrong|incorrect|don't|do not)\s+(.+)/i,
      /(?:actually|instead|rather)\s+(.+)/i,
    ];

    for (const pattern of correctionPatterns) {
      const match = userMessage.match(pattern);
      if (match && match[0].length < 80) {
        const fact = 'User correction: ' + match[0].trim();
        const existing = this.memory.getAll();
        if (!existing.find(e => e.content.toLowerCase() === fact.toLowerCase())) {
          this.memory.add({ content: fact, timestamp: Date.now(), category: 'user-preference' });
          found = true;
        }
      }
    }

    return found;
  }

  // LLM-based extraction -- fire-and-forget (doesn't block the agent loop)
  extractFactsWithLLM(userMessage: string, assistantResponse: string): void {
    this._doLLMExtraction(userMessage, assistantResponse).catch(() => {});
  }

  private async _doLLMExtraction(
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    // Use injected config from extension.ts first, fall back to env resolution
    const cfg = this.llmConfig;
    const apiKey = cfg ? cfg.apiKey : '';
    const baseURL = cfg ? cfg.baseURL : '';
    const model = cfg ? cfg.model : '';

    if (!apiKey || !baseURL || !model) return;

    const combined = userMessage + ' ' + assistantResponse;
    const factIndicators = [
      'my name', 'i prefer', 'i like', 'i want', 'always', 'never',
      'use ', 'using ', 'project', 'installed', 'created', 'built',
      'typescript', 'javascript', 'python', 'react', 'vue', 'angular',
    ];

    const hasFactIndicators = factIndicators.some(ind =>
      combined.toLowerCase().includes(ind)
    );

    if (!hasFactIndicators) return;

    const prompt = 'Extract any user preferences, identity facts, or project environment facts from this conversation. Return ONLY a JSON array of facts (max 5), or an empty array if none found. Format: ["fact1", "fact2"]\n\nUser: ' + userMessage.substring(0, 200) + '\nAssistant: ' + assistantResponse.substring(0, 200) + '\n\nFacts:';

    try {
      const response = await fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(config.memoryLlmTimeoutMs),
      });

      if (!response.ok) return;

      const data: any = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) return;

      try {
        const facts = JSON.parse(content);
        if (Array.isArray(facts)) {
          for (const fact of facts) {
            if (typeof fact === 'string' && fact.length < 100) {
              this.memory.add({
                content: fact,
                timestamp: Date.now(),
                category: 'fact',
              });
            }
          }
        }
      } catch {
        if (content.length < 100 && content !== '[]' && content !== 'none') {
          this.memory.add({
            content: content,
            timestamp: Date.now(),
            category: 'fact',
          });
        }
      }
    } catch {
      // Fail silently - regex extraction already ran
    }
  }
}
