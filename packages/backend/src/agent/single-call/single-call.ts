// packages/backend/src/agent/single-call/single-call.ts
// Single-Call Agent — raw HTTP, no SDK, strict JSON output, self-healing retries

import type {
  SingleCallConfig,
  SingleCallRequest,
  SingleCallResponse,
  LLMMessage,
} from '@pulse-ide/shared';
import { callLLM, LLMError } from './http-client.js';

// ---------------------------------------------------------------------------
// Default system prompt — forces strict JSON output
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a senior software engineer. Your task is to edit a single file.

You must analyze the query and the file content.

Output ONLY a valid JSON object with the following fields:
- "filePath": the absolute or relative path of the file.
- "diff": a unified diff (--- a, +++ b, @@ hunks) showing ONLY the changed lines.
- "explanation": a brief, one-sentence explanation of the change.

Do NOT include any markdown, code fences, or extra text. Output ONLY raw JSON.`;

const CORRECTION_PROMPT = `The previous response was invalid JSON or missing required fields.

Please output a valid JSON object with exactly these fields:
- "filePath": the file path
- "diff": a unified diff showing the changes
- "explanation": a brief explanation

Output ONLY raw JSON. No markdown, no code fences, no extra text.`;

// ---------------------------------------------------------------------------
// Config from environment — no hardcoding
// ---------------------------------------------------------------------------
export function getConfigFromEnv(): SingleCallConfig {
  const endpoint = process.env['OLLAMA_URL']
    || process.env['LLM_ENDPOINT']
    || 'http://localhost:11434/api/chat';

  const model = process.env['OLLAMA_MODEL']
    || process.env['LLM_MODEL']
    || 'deepseek-r1:14b';

  const apiKey = process.env['LLM_API_KEY'] || '';

  const maxRetries = parseInt(process.env['LLM_MAX_RETRIES'] || '3', 10);
  const timeoutMs = parseInt(process.env['LLM_TIMEOUT_MS'] || '60000', 10);
  const temperature = parseFloat(process.env['LLM_TEMPERATURE'] || '0.1');

  return {
    provider: 'ollama',
    endpoint,
    apiKey,
    model,
    maxRetries: isNaN(maxRetries) ? 3 : maxRetries,
    timeoutMs: isNaN(timeoutMs) ? 60000 : timeoutMs,
    temperature: isNaN(temperature) ? 0.1 : temperature,
  };
}

// ---------------------------------------------------------------------------
// Validate diff format
// ---------------------------------------------------------------------------
function isValidDiff(diff: string): boolean {
  if (!diff || diff.trim().length === 0) return false;
  // Basic sanity check: unified diff should contain --- and +++
  return diff.includes('---') && diff.includes('+++');
}

// ---------------------------------------------------------------------------
// Parse JSON from LLM response (handles markdown code fences)
// ---------------------------------------------------------------------------
function parseResponse(content: string): { filePath: string; diff: string; explanation: string } | null {
  let jsonStr = content.trim();

  // Strip markdown code fences if present
  const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeFenceMatch) {
    jsonStr = codeFenceMatch[1].trim();
  }

  // Try to find JSON object in the response
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.filePath && parsed.diff) {
      return {
        filePath: String(parsed.filePath),
        diff: String(parsed.diff),
        explanation: String(parsed.explanation || ''),
      };
    }
  } catch {
    // JSON parse failed
  }

  return null;
}

// ---------------------------------------------------------------------------
// SingleCallAgent class
// ---------------------------------------------------------------------------
export class SingleCallAgent {
  private config: SingleCallConfig;

  constructor(config?: Partial<SingleCallConfig>) {
    this.config = { ...getConfigFromEnv(), ...config };
  }

  async run(request: SingleCallRequest): Promise<SingleCallResponse> {
    const startTime = Date.now();
    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: this.buildUserMessage(request),
      },
    ];

    let lastError = '';

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await callLLM(this.config, messages);
        const parsed = parseResponse(response.content);

        if (!parsed) {
          lastError = 'Failed to parse JSON from LLM response';
          // Add correction prompt for retry
          messages.push(
            { role: 'assistant', content: response.content },
            { role: 'user', content: CORRECTION_PROMPT }
          );
          continue;
        }

        if (!isValidDiff(parsed.diff)) {
          lastError = 'Invalid or empty diff in response';
          messages.push(
            { role: 'assistant', content: response.content },
            { role: 'user', content: `${CORRECTION_PROMPT}\n\nThe diff field must contain a valid unified diff with --- and +++ markers.` }
          );
          continue;
        }

        const duration = Date.now() - startTime;
        return {
          success: true,
          filePath: parsed.filePath,
          diff: parsed.diff,
          explanation: parsed.explanation,
          retries: attempt,
          duration,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        // On timeout or network error, retry
        if (err instanceof LLMError && err.statusCode === 408) {
          continue;
        }

        // On 4xx errors (auth, bad request), don't retry
        if (err instanceof LLMError && err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
          lastError = `${err.statusCode}: ${err.message}`;
          break;
        }

        // On 5xx, retry
        continue;
      }
    }

    const duration = Date.now() - startTime;
    return {
      success: false,
      filePath: request.filePath,
      diff: '',
      error: `Failed after ${this.config.maxRetries + 1} attempts. Last error: ${lastError}`,
      retries: this.config.maxRetries,
      duration,
    };
  }

  private buildUserMessage(request: SingleCallRequest): string {
    let msg = `Query: ${request.query}\n\n`;
    msg += `File: ${request.filePath}\n\n`;
    msg += `Content:\n\`\`\`\n${request.fileContent}\n\`\`\``;

    if (request.context) {
      msg += `\n\nProject Context:\n${request.context}`;
    }

    return msg;
  }
}
