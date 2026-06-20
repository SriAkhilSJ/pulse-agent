// packages/backend/src/server/sse.ts
// SSE server — streams agent events to the frontend

import * as http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { AgentEventStream } from '../protocols/ag-ui/stream.js';
import { SSE_HEADERS } from '@pulse-ide/shared';
import type { AgentRunRequest } from '@pulse-ide/shared';
import { route } from '../agent/router.js';
import { SingleCallAgent, getConfigFromEnv } from '../agent/single-call/single-call.js';
import { runMultiCallAgent } from '../agent/graph/multi-call.js';
import type { RouteContext, SingleCallConfig } from '@pulse-ide/shared';
import { RouteType } from '@pulse-ide/shared';
import { tracer } from '../observability/tracer.js';
import { SemanticCache } from '../cache/semantic-cache.js';

// Singleton cache instance
let cache: SemanticCache | null = null;
function getCache(): SemanticCache {
  if (!cache) {
    cache = new SemanticCache();
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Parse JSON body from request
// ---------------------------------------------------------------------------
function parseBody(req: IncomingMessage): Promise<AgentRunRequest> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as AgentRunRequest);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Handle SSE connection for agent run
// ---------------------------------------------------------------------------
export async function handleAgentStream(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Only accept POST
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let request: AgentRunRequest;
  try {
    request = await parseBody(req);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  if (!request.query || request.query.trim().length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Query is required' }));
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const stream = new AgentEventStream();
  let clientDisconnected = false;

  // Handle client disconnect
  req.on('close', () => {
    clientDisconnected = true;
    stream.close();
  });

  // Pipe events to SSE
  stream.pipeToSSE(res);

  try {
    // Check semantic cache first
    const cached = await getCache().lookup(request.query);
    if (cached) {
      stream.stateUpdate('cache-hit', { similarity: '>' + String((getCache() as any).config.similarityThreshold) });
      stream.textDelta(cached.response);
      stream.done('Served from cache');
      stream.close();
      return;
    }

    // Route the query
    const routeContext: RouteContext = {
      query: request.query,
      currentFileContent: request.fileContent || '',
      cursorPosition: 0,
      activeFilePath: request.filePath || '',
      workspaceFiles: [],
      recentEdits: [],
      conversationHistoryLength: 0,
    };

    const decision = route(routeContext);

    // Start trace
    tracer.startTrace(request.query, decision.type, 'deepseek-r1:14b', request.sessionId || 'default');
    tracer.logStep({ type: 'plan', name: 'route', input: request.query, output: decision, durationMs: 0 });

    stream.stateUpdate('routing', { route: decision.type, reason: decision.reason });

    if (decision.type === RouteType.SINGLE_CALL) {
      await runSingleCallAgent(request, stream);
    } else {
      await runMultiCallAgentSSE(request, stream);
    }

    // Store in cache and end trace
    const trace = await tracer.endTrace(true);
    if (trace) {
      await getCache().store(request.query, `Completed via ${decision.type}`, decision.type);
    }

    if (!clientDisconnected) {
      stream.done(`Task completed via ${decision.type} route`);
    }
  } catch (err) {
    await tracer.endTrace(false, err instanceof Error ? err.message : String(err));
    if (!clientDisconnected) {
      stream.error(err instanceof Error ? err.message : String(err));
    }
  } finally {
    if (!clientDisconnected) {
      stream.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Run single-call agent with event streaming
// ---------------------------------------------------------------------------
async function runSingleCallAgent(
  request: AgentRunRequest,
  stream: AgentEventStream
): Promise<void> {
  const config: SingleCallConfig = getConfigFromEnv();
  const agent = new SingleCallAgent(config);

  stream.stateUpdate('single-call-start', { model: config.model });

  const result = await agent.run({
    query: request.query,
    filePath: request.filePath || 'unknown.ts',
    fileContent: request.fileContent || '',
    context: request.context,
  });

  if (result.success) {
    stream.stateUpdate('single-call-complete', { filePath: result.filePath });
    stream.textDelta(result.diff);
  } else {
    stream.error(result.error || 'Single-call agent failed');
  }
}

// ---------------------------------------------------------------------------
// Run multi-call agent with event streaming
// ---------------------------------------------------------------------------
async function runMultiCallAgentSSE(
  request: AgentRunRequest,
  stream: AgentEventStream
): Promise<void> {
  stream.stateUpdate('multi-call-start', {});

  const result = runMultiCallAgent(request.query, {
    model: 'openrouter/owl-alpha',
    apiKey: process.env['LLM_API_KEY'] || '',
    baseURL: process.env['OLLAMA_URL'] || 'http://localhost:11434/api/chat',
    maxIterations: 10,
    temperature: 0.1,
  });

  // Emit events for each step
  for (const step of result.currentPlan) {
    stream.stateUpdate('planning', { step });
  }

  for (const step of result.completedSteps) {
    stream.stateUpdate('completed', { step });
  }

  for (const change of result.fileChanges) {
    stream.toolCall('edit_file', { path: change.filePath, content: change.newContent }, `tool-${Date.now()}`);
    stream.toolResult('edit_file', `Edited ${change.filePath}`, `tool-${Date.now()}`);
  }

  if (result.status === 'done') {
    stream.stateUpdate('multi-call-complete', { stepsCompleted: result.completedSteps.length });
  } else if (result.error) {
    stream.error(result.error);
  }
}

// ---------------------------------------------------------------------------
// Create the full HTTP server with SSE endpoint
// ---------------------------------------------------------------------------
export function createSSEServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // Agent SSE endpoint
    if (req.url === '/api/agent/run' && req.method === 'POST') {
      handleAgentStream(req, res);
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    console.log(`[AG-UI] SSE server running on port ${port}`);
    console.log(`[AG-UI] POST http://localhost:${port}/api/agent/run`);
  });

  return server;
}
