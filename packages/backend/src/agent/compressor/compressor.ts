// packages/backend/src/agent/compressor/compressor.ts
// Context Compressor — Hermes-style sliding window compression
// Keep start + end, compress the middle via raw HTTP to Ollama

import type {
  ConversationMessage,
  CompressorConfig,
  CompressedSummary,
} from '@pulse-ide/shared';
import { getDefaultCompressorConfig } from '@pulse-ide/shared';

// ---------------------------------------------------------------------------
// Summarization prompt — your secret sauce
// ---------------------------------------------------------------------------
const SUMMARIZATION_PROMPT = `You are a conversation summarizer for an AI coding assistant.

Summarize the following conversation middle section into a dense JSON structure.

Preserve:
- Decisions made (what was decided, not discussed)
- Files mentioned (file paths)
- Code changes (what was written/modified)
- Unresolved questions (what still needs to be answered)
- Key facts (important context that must not be lost)

Output ONLY valid JSON with this exact structure:
{
  "decisions": ["decision 1", "decision 2"],
  "filesMentioned": ["path/to/file.ts", "another/file.ts"],
  "codeChanges": ["description of change 1", "description of change 2"],
  "unresolvedQuestions": ["question 1", "question 2"],
  "keyFacts": ["fact 1", "fact 2"]
}

Do NOT include any markdown, code fences, or extra text. Output ONLY raw JSON.

Conversation to summarize:
`;

// ---------------------------------------------------------------------------
// Estimate token count (rough: 1 token ≈ 4 chars)
// ---------------------------------------------------------------------------
function estimateTokens(messages: ConversationMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}

// ---------------------------------------------------------------------------
// Rule-based fallback extractor (when Ollama is unavailable)
// ---------------------------------------------------------------------------
function ruleBasedSummary(messages: ConversationMessage[]): CompressedSummary {
  const text = messages.map(m => m.content).join('\n');

  // Extract file paths
  const filePattern = /[\w\-./]+\.(ts|tsx|js|jsx|py|java|c|cpp|cs|go|rs|rb|php|md|json|yaml|yml|html|css|scss|sh|bash|zsh|ps1|sql)/gi;
  const files = [...new Set(text.match(filePattern) || [])];

  // Extract decisions (lines with "decided", "will", "should", "let's")
  const decisionPatterns = [
    /(?:decided|will|should|let's|going to|need to|must)\s+([^.!?\n]+)/gi,
  ];
  const decisions: string[] = [];
  for (const pattern of decisionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      decisions.push(match[0].trim());
    }
  }

  // Extract code changes (lines with "edit", "change", "update", "write", "create")
  const changePatterns = [
    /(?:edited?|changed?|updated?|wrote|created?|modified?|added?|removed?|deleted?)\s+([^.!?\n]+)/gi,
  ];
  const codeChanges: string[] = [];
  for (const pattern of changePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      codeChanges.push(match[0].trim());
    }
  }

  // Extract unresolved questions
  const questionLines = text.split('\n').filter(line => line.trim().endsWith('?'));

  // Extract key facts (lines with "important", "note", "remember", "key")
  const factPatterns = [
    /(?:important|note|remember|key|critical|warning):\s*([^.!?\n]+)/gi,
  ];
  const keyFacts: string[] = [];
  for (const pattern of factPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      keyFacts.push(match[0].trim());
    }
  }

  return {
    decisions: [...new Set(decisions)].slice(0, 10),
    filesMentioned: files.slice(0, 20),
    codeChanges: [...new Set(codeChanges)].slice(0, 10),
    unresolvedQuestions: questionLines.slice(0, 5),
    keyFacts: [...new Set(keyFacts)].slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Call Ollama to summarize the middle section
// ---------------------------------------------------------------------------
async function summarizeMiddle(
  messages: ConversationMessage[],
  config: CompressorConfig
): Promise<CompressedSummary> {
  const prompt = SUMMARIZATION_PROMPT + JSON.stringify(messages, null, 2);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data?.response || '';

    // Try to parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        decisions: parsed.decisions || [],
        filesMentioned: parsed.filesMentioned || [],
        codeChanges: parsed.codeChanges || [],
        unresolvedQuestions: parsed.unresolvedQuestions || [],
        keyFacts: parsed.keyFacts || [],
      };
    }

    throw new Error('No JSON found in Ollama response');
  } catch (err) {
    clearTimeout(timeoutId);
    // Fallback to rule-based extraction
    return ruleBasedSummary(messages);
  }
}

// ---------------------------------------------------------------------------
// Main compressor class
// ---------------------------------------------------------------------------
export class Compressor {
  private config: CompressorConfig;

  constructor(config?: Partial<CompressorConfig>) {
    this.config = { ...getDefaultCompressorConfig(), ...config };
  }

  /**
   * Compress a conversation history.
   * - Keep first N messages (system prompt + initial context)
   * - Keep last M messages (most recent interaction)
   * - Compress everything in between
   */
  async compress(messages: ConversationMessage[]): Promise<ConversationMessage[]> {
    const { preserveStart, preserveEnd, triggerMessageThreshold, triggerTokenThreshold } = this.config;

    // Not enough messages to compress
    if (messages.length <= preserveStart + preserveEnd + 1) {
      return messages;
    }

    // Check token threshold
    const estimatedTokens = estimateTokens(messages);
    if (messages.length < triggerMessageThreshold && estimatedTokens < triggerTokenThreshold) {
      return messages;
    }

    // Split into head, middle, tail
    const head = messages.slice(0, preserveStart);
    const tail = messages.slice(-preserveEnd);
    const middle = messages.slice(preserveStart, messages.length - preserveEnd);

    // Nothing to compress
    if (middle.length === 0) {
      return messages;
    }

    // Summarize the middle
    const summary = await summarizeMiddle(middle, this.config);

    // Build compressed summary message
    const summaryContent = JSON.stringify(summary, null, 2);
    const compressedMessage: ConversationMessage = {
      role: 'system',
      content: `[Compressed conversation summary — ${middle.length} messages compressed]\n${summaryContent}`,
    };

    return [...head, compressedMessage, ...tail];
  }

  /**
   * Synchronous compression using rule-based fallback only.
   * Use this when you don't want to wait for Ollama.
   */
  compressSync(messages: ConversationMessage[]): ConversationMessage[] {
    const { preserveStart, preserveEnd, triggerMessageThreshold, triggerTokenThreshold } = this.config;

    if (messages.length <= preserveStart + preserveEnd + 1) {
      return messages;
    }

    const estimatedTokens = estimateTokens(messages);
    if (messages.length < triggerMessageThreshold && estimatedTokens < triggerTokenThreshold) {
      return messages;
    }

    const head = messages.slice(0, preserveStart);
    const tail = messages.slice(-preserveEnd);
    const middle = messages.slice(preserveStart, messages.length - preserveEnd);

    if (middle.length === 0) {
      return messages;
    }

    const summary = ruleBasedSummary(middle);
    const summaryContent = JSON.stringify(summary, null, 2);
    const compressedMessage: ConversationMessage = {
      role: 'system',
      content: `[Compressed conversation summary — ${middle.length} messages compressed]\n${summaryContent}`,
    };

    return [...head, compressedMessage, ...tail];
  }
}
