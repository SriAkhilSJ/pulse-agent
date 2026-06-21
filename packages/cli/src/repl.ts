// packages/cli/src/repl.ts — Interactive REPL + single query handler

import * as readline from 'readline';
import chalk from 'chalk';
import { Agent, ToolRegistry } from '@pulse-ide/backend';
import { showThinking, showError, stopSpinner } from './output.js';

let agent: Agent | null = null;

function getAgent(): Agent {
  if (!agent) {
    const registry = new ToolRegistry();
    agent = new Agent('', 'http://localhost:11434/v1', registry, { model: 'deepseek-r1:14b' });
  }
  return agent;
}

export async function startRepl(_workspaceRoot: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const a = getAgent();

  const askQuestion = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(chalk.green('You > '), (answer) => {
        resolve(answer);
      });
    });
  };

  console.log(chalk.dim('Type "exit" or Ctrl+C to quit.\n'));

  while (true) {
    const query = await askQuestion();
    const trimmed = query.trim();

    if (!trimmed) continue;
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log(chalk.yellow('👋 Goodbye!'));
      rl.close();
      process.exit(0);
    }

    await handleQuery(a, trimmed);
  }
}

export async function runSingleQuery(query: string, _workspaceRoot: string) {
  const a = getAgent();
  await handleQuery(a, query);
  process.exit(0);
}

async function handleQuery(a: Agent, query: string) {
  showThinking();

  try {
    let fullResponse = '';
    let firstChunk = true;

    await a.chat(
      query,
      [],
      undefined,
      (text: string) => {
        stopSpinner();
        if (firstChunk) {
          process.stdout.write(chalk.blue('\n🤖 Pulse: '));
          firstChunk = false;
        }
        process.stdout.write(chalk.gray(text));
      },
      (text: string) => {
        stopSpinner();
        if (firstChunk) {
          process.stdout.write(chalk.blue('\n🤖 Pulse: '));
          firstChunk = false;
        }
        process.stdout.write(chalk.white(text));
        fullResponse += text;
      },
      undefined,
    );

    if (!fullResponse) {
      process.stdout.write(chalk.blue('\n🤖 Pulse: '));
      process.stdout.write(chalk.gray('(no response)'));
    }

    console.log('\n');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showError(msg);
  }
}
