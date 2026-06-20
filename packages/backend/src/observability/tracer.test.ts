// packages/backend/src/observability/tracer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tracer } from './tracer.js';

// Mock fetch for LangSmith
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Tracer', () => {
  let tracer: Tracer;

  beforeEach(() => {
    vi.clearAllMocks();
    tracer = new Tracer();
    // Clear env vars
    delete process.env['LANGSMITH_API_KEY'];
  });

  it('should start a trace', () => {
    const trace = tracer.startTrace('test query', 'single_call', 'deepseek-r1:14b', 'session-1');

    expect(trace).toBeDefined();
    expect(trace.query).toBe('test query');
    expect(trace.route).toBe('single_call');
    expect(trace.model).toBe('deepseek-r1:14b');
    expect(trace.sessionId).toBe('session-1');
    expect(trace.steps).toHaveLength(0);
    expect(trace.success).toBe(false);
  });

  it('should log steps', () => {
    tracer.startTrace('test', 'single_call', 'deepseek-r1:14b', 's1');
    tracer.logStep({
      type: 'llm',
      name: 'gpt-4',
      input: 'Hello',
      output: 'World',
      durationMs: 100,
    });

    const current = tracer.getCurrentTrace();
    expect(current!.steps).toHaveLength(1);
    expect(current!.steps[0].type).toBe('llm');
  });

  it('should estimate tokens', () => {
    tracer.startTrace('short query', 'single_call', 'deepseek-r1:14b', 's1');
    tracer.logStep({
      type: 'llm',
      name: 'test',
      input: 'a'.repeat(100), // 25 tokens
      output: 'b'.repeat(200), // 50 tokens
      durationMs: 50,
    });

    const current = tracer.getCurrentTrace();
    expect(current!.tokensInput).toBeGreaterThan(0);
    expect(current!.tokensOutput).toBeGreaterThan(0);
  });

  it('should end trace successfully', async () => {
    tracer.startTrace('test', 'multi_call', 'deepseek-r1:14b', 's1');
    tracer.logStep({ type: 'plan', name: 'route', input: 'test', output: {}, durationMs: 10 });

    const trace = await tracer.endTrace(true);

    expect(trace).toBeDefined();
    expect(trace!.success).toBe(true);
    expect(trace!.durationMs).toBeGreaterThanOrEqual(0);
    expect(trace!.steps).toHaveLength(1);
  });

  it('should end trace with error', async () => {
    tracer.startTrace('test', 'single_call', 'deepseek-r1:14b', 's1');
    const trace = await tracer.endTrace(false, 'Something went wrong');

    expect(trace).toBeDefined();
    expect(trace!.success).toBe(false);
    expect(trace!.error).toBe('Something went wrong');
  });

  it('should not send to LangSmith when no API key', async () => {
    delete process.env['LANGSMITH_API_KEY'];
    tracer.startTrace('test', 'single_call', 'deepseek-r1:14b', 's1');
    await tracer.endTrace(true);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send to LangSmith when API key is set', async () => {
    process.env['LANGSMITH_API_KEY'] = 'test-key';
    const tracerWithKey = new Tracer();
    tracerWithKey.startTrace('test', 'single_call', 'deepseek-r1:14b', 's1');

    mockFetch.mockResolvedValueOnce({ ok: true });
    await tracerWithKey.endTrace(true);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('runs'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-key',
        }),
      })
    );
  });

  it('should handle LangSmith send failure gracefully', async () => {
    process.env['LANGSMITH_API_KEY'] = 'test-key';
    const tracerWithKey = new Tracer();
    tracerWithKey.startTrace('test', 'single_call', 'deepseek-r1:14b', 's1');

    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const trace = await tracerWithKey.endTrace(true);

    expect(trace).toBeDefined();
    expect(trace!.success).toBe(true); // Trace still succeeds even if LangSmith fails
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should clear current trace after ending', async () => {
    tracer.startTrace('test', 'single_call', 'deepseek-r1:14b', 's1');
    await tracer.endTrace(true);

    expect(tracer.getCurrentTrace()).toBeNull();
  });

  it('should calculate cost for paid models', async () => {
    tracer.startTrace('test', 'single_call', 'gpt-4o', 's1');
    tracer.logStep({
      type: 'llm',
      name: 'gpt-4o',
      input: 'a'.repeat(1000), // ~250 tokens
      output: 'b'.repeat(2000), // ~500 tokens
      durationMs: 100,
    });

    const trace = await tracer.endTrace(true);
    expect(trace!.cost).toBeGreaterThan(0);
  });

  it('should have zero cost for local models', async () => {
    tracer.startTrace('test', 'single_call', 'deepseek-r1:14b', 's1');
    tracer.logStep({
      type: 'llm',
      name: 'local',
      input: 'a'.repeat(1000),
      output: 'b'.repeat(2000),
      durationMs: 100,
    });

    const trace = await tracer.endTrace(true);
    expect(trace!.cost).toBe(0);
  });
});
