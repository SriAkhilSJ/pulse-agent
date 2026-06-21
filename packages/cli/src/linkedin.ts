// packages/cli/src/linkedin.ts
// LinkedIn Automation Agent — uses web_search, browser, desktop, vision tools

import * as readline from 'readline';
import chalk from 'chalk';
import { showThinking, showError, showToolUse, showToolResult, stopSpinner } from './output.js';

// Tool execution via backend API
const API_BASE = 'http://localhost:3001';

async function callAgent(query: string): Promise<string> {
  const response = await fetch(`${API_BASE}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, sessionId: 'linkedin-agent' }),
  });

  if (!response.ok) {
    throw new Error(`Agent error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.substring(6));
          if (event.type === 'text-delta' || event.type === 'textDelta') {
            process.stdout.write(chalk.white(event.content || event.text || ''));
            result += event.content || event.text || '';
          } else if (event.type === 'tool-call' || event.type === 'toolCall') {
            showToolUse(event.tool || event.name || 'unknown');
          } else if (event.type === 'done') {
            stopSpinner();
          }
        } catch { /* skip malformed */ }
      }
    }
  }

  return result;
}

export async function linkedinAgent() {
  console.log(chalk.cyan('\n🔗 LinkedIn Automation Agent'));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.white('I can help you with:'));
  console.log(chalk.gray('  • Search for people/jobs on LinkedIn'));
  console.log(chalk.gray('  • Auto-apply to jobs'));
  console.log(chalk.gray('  • Send connection requests'));
  console.log(chalk.gray('  • Post content'));
  console.log(chalk.gray('  • Scrape profiles'));
  console.log(chalk.gray('  • Send messages'));
  console.log(chalk.gray('Type "exit" to quit.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): Promise<string> => new Promise((resolve) => {
    rl.question(chalk.green('🔗 LinkedIn > '), resolve);
  });

  while (true) {
    const query = (await ask()).trim();
    if (!query) continue;
    if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
      console.log(chalk.yellow('👋 Goodbye!'));
      rl.close();
      process.exit(0);
    }

    showThinking();
    try {
      const result = await callAgent(`LinkedIn task: ${query}`);
      if (result) {
        console.log(chalk.blue('\n🤖 Result:\n'));
        console.log(chalk.white(result));
      }
      console.log('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(msg);
      console.log(chalk.yellow('\n⚠️  Make sure the backend is running:'));
      console.log(chalk.gray('   cd packages/backend && node dist/server.js\n'));
    }
  }
}
