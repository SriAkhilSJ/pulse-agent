// packages/cli/src/output.ts — Colorized streaming output helpers

import chalk from 'chalk';

let isSpinning = false;
let spinInterval: ReturnType<typeof setInterval> | null = null;

const spinFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function showThinking(): void {
  if (isSpinning) return;
  isSpinning = true;
  let frame = 0;
  spinInterval = setInterval(() => {
    const f = spinFrames[frame % spinFrames.length];
    process.stdout.write(`\r  ${chalk.yellow(f)} ${chalk.gray('Thinking...')}  `);
    frame++;
  }, 80);
}

export function showToolUse(toolName: string) {
  stopSpinner();
  console.log(chalk.magenta(`  🔧 Using tool: ${toolName}`));
}

export function showToolResult(toolName: string, result: string) {
  const preview = result.length > 80 ? result.substring(0, 80) + '...' : result;
  console.log(chalk.dim(`  ✅ ${toolName}: ${preview}`));
}

export function showError(msg: string) {
  stopSpinner();
  console.log(chalk.red(`\n❌ Error: ${msg}\n`));
}

export function showSuccess(msg: string) {
  stopSpinner();
  console.log(chalk.green(`✅ ${msg}`));
}

export function stopSpinner() {
  if (spinInterval) { clearInterval(spinInterval); spinInterval = null; }
  if (isSpinning) { process.stdout.write('\r' + ' '.repeat(40) + '\r'); isSpinning = false; }
}
