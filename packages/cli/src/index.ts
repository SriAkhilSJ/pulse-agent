#!/usr/bin/env node
// packages/cli/src/index.ts — PulseCode AI CLI entry point

import { program } from 'commander';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { startRepl, runSingleQuery } from './repl.js';

// Load .env from monorepo root
dotenv.config({ path: resolve(__dirname, '../../.env') });

program
  .name('pulse')
  .description('PulseCode AI Agent — Surpass Cursor/Claude from your terminal')
  .version('0.1.0');

program
  .command('chat')
  .description('Start an interactive coding session')
  .option('-w, --workspace <path>', 'Workspace root', process.cwd())
  .action(async (options: { workspace: string }) => {
    console.log(chalk.cyan('⚡ PulseCode Agent initialized.'));
    console.log(chalk.gray(`📁 Workspace: ${options.workspace}`));
    console.log(chalk.gray('💬 Type your coding question. Type "exit" or Ctrl+C to quit.\n'));
    await startRepl(options.workspace);
  });

// Direct query: pulse "read my index.ts"
program
  .argument('[query]', 'Direct query to the agent')
  .option('-w, --workspace <path>', 'Workspace root', process.cwd())
  .action(async (query: string | undefined, options: { workspace: string }) => {
    if (!query) { program.help(); return; }
    await runSingleQuery(query, options.workspace);
  });

program.parse();
