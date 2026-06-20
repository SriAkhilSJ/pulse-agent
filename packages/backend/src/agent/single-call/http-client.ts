// packages/backend/src/agent/single-call/http-client.ts
// Raw HTTP client for LLM API calls — zero SDK dependencies
// Works with Ollama, OpenAI, DeepSeek, or any OpenAI-compatible endpoint

import type { SingleCallConfig, LLMMessage, LLMResponse } from '@pulse-ide/shared';

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * Call an LLM endpoint via raw fetch — no SDK.
 *
 * Supports two API formats:
 * - Ollama:  { model, messages, stream: false }
 * - OpenAI:  { model, messages }
 *
 * Auto-detects based on the endpoint URL.
 */
export async function callLLM(
  config: SingleCallConfig,
  messages: LLMMessage[]
): Promise<LLMResponse> {
  const isOllama = config.endpoint.includes('ollama') || config.endpoint.includes('11434') || config.endpoint.includes('ngrok');
  const isStream = false; // We always request non-streaming for single-call

  // Build payload based on provider
  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: isStream,
  };

  // Ollama uses 'options' for temperature; OpenAI uses top-level
  if (isOllama) {
    payload.options = {
      temperature: config.temperature,
    };
  } else {
    payload.temperature = config.temperature;
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Only set Authorization if apiKey is provided (Ollama doesn't need one)
  if (config.apiKey && config.apiKey.length > 0) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // Timeout via AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  const startTime = Date.now();

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new LLMError(
        `LLM API error ${response.status}: ${errorBody || response.statusText}`,
        response.status,
        errorBody
      );
    }

    const data = await response.json() as any;

    // Extract content from response
    // Ollama: { message: { content } }
    // OpenAI: { choices: [{ message: { content } }] }
    let content = '';

    if (data?.message?.content) {
      // Ollama format
      content = data.message.content;
    } else if (data?.choices?.[0]?.message?.content) {
      // OpenAI format
      content = data.choices[0].message.content;
    } else if (data?.choices?.[0]?.delta?.content) {
      // Streaming chunk (shouldn't happen with stream:false, but handle it)
      content = data.choices[0].delta.content;
    } else {
      throw new LLMError(
        `Unexpected response format: ${JSON.stringify(data).substring(0, 200)}`,
        response.status
      );
    }

    return {
      content,
      model: data?.model || config.model,
      duration,
    };
  } catch (err) {
    const duration = Date.now() - startTime;

    if (err instanceof LLMError) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
      throw new LLMError(
        `Request timed out after ${config.timeoutMs}ms`,
        408
      );
    }

    throw new LLMError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
