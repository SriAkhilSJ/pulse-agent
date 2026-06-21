// packages/backend/src/smoke.test.ts
// Run with: npx ts-node packages/backend/src/smoke.test.ts
import { route } from './agent/router.js';
import { SingleCallAgent, getConfigFromEnv } from './agent/single-call/single-call.js';
import { runMultiCallAgent } from './agent/graph/multi-call.js';
import { validate } from './validation/ast-validator.js';
import { Tracer } from './observability/tracer.js';
import { getDefaultCostConfig } from '@pulse-ide/shared';

async function smoke() {
  console.log('🔥 Running $0 smoke test...');
  let passed = 0;
  let failed = 0;

  // Test 1: Router
  try {
    const decision = route({ query: 'hello', currentFileContent: '', cursorPosition: 0, activeFilePath: '', workspaceFiles: [], recentEdits: [], conversationHistoryLength: 0 });
    console.log(`  ✅ Router: ${decision.type}`);
    passed++;
  } catch (e) {
    console.error('  ❌ Router:', e);
    failed++;
  }

  // Test 2: SingleCallAgent constructs
  try {
    const agent = new SingleCallAgent(getConfigFromEnv());
    console.log('  ✅ SingleCallAgent: constructed');
    passed++;
  } catch (e) {
    console.error('  ❌ SingleCallAgent:', e);
    failed++;
  }

  // Test 3: AST Validator
  try {
    const result = validate('test.ts', 'const x = 1;');
    console.log(`  ✅ AST Validator: isValid=${result.isValid}`);
    passed++;
  } catch (e) {
    console.error('  ❌ AST Validator:', e);
    failed++;
  }

  // Test 4: Tracer
  try {
    const tracer = new Tracer();
    tracer.startTrace('test', 'single_call', 'test-model', 'test-session');
    tracer.endTrace(true);
    console.log('  ✅ Tracer: start/end trace');
    passed++;
  } catch (e) {
    console.error('  ❌ Tracer:', e);
    failed++;
  }

  // Test 5: CostController
  try {
    const { CostController } = await import('./cost/cost-controller.js');
    const cc = new CostController(getDefaultCostConfig());
    cc.initSession('test', 'test');
    console.log('  ✅ CostController: constructed + init');
    passed++;
  } catch (e) {
    console.error('  ❌ CostController:', e);
    failed++;
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

smoke();
