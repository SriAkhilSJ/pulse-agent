// packages/backend/src/checkpoint/checkpoint-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CheckpointStore } from './checkpoint-store.js';
import * as fs from 'fs';
import type { Checkpoint } from '@pulse-ide/shared';

const TEST_DB = './test-checkpoints.db';

function createTestCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  const now = Date.now();
  return {
    id: `cp-${now}`,
    sessionId: 'session-1',
    query: 'Fix the auth bug',
    route: 'single_call',
    status: 'running',
    messages: [
      { role: 'user', content: 'Fix the auth bug', timestamp: now },
      { role: 'assistant', content: 'I will fix it', timestamp: now + 100 },
    ],
    currentPlan: ['Read auth.ts', 'Fix the bug', 'Verify'],
    completedSteps: ['Read auth.ts'],
    filesRead: ['/workspace/src/auth.ts'],
    fileChanges: [],
    iteration: 1,
    maxIterations: 10,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('CheckpointStore', () => {
  let store: CheckpointStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = new CheckpointStore({ dbPath: TEST_DB, maxCheckpointsPerSession: 10 });
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should save and load a checkpoint', () => {
    const cp = createTestCheckpoint();
    store.save(cp);

    const loaded = store.load(cp.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(cp.id);
    expect(loaded!.query).toBe('Fix the auth bug');
    expect(loaded!.status).toBe('running');
  });

  it('should load the latest checkpoint for a session', () => {
    const cp1 = createTestCheckpoint({ id: 'cp-1', updatedAt: 1000 });
    const cp2 = createTestCheckpoint({ id: 'cp-2', updatedAt: 2000, status: 'completed' });

    store.save(cp1);
    store.save(cp2);

    const latest = store.loadLatest('session-1');
    expect(latest).toBeDefined();
    expect(latest!.id).toBe('cp-2');
    expect(latest!.status).toBe('completed');
  });

  it('should list all checkpoints for a session', () => {
    store.save(createTestCheckpoint({ id: 'cp-1' }));
    store.save(createTestCheckpoint({ id: 'cp-2' }));
    store.save(createTestCheckpoint({ id: 'cp-3', sessionId: 'session-2' }));

    const checkpoints = store.listBySession('session-1');
    expect(checkpoints).toHaveLength(2);
  });

  it('should list sessions with latest checkpoint', () => {
    store.save(createTestCheckpoint({ id: 'cp-1', sessionId: 's1', query: 'Query A' }));
    store.save(createTestCheckpoint({ id: 'cp-2', sessionId: 's2', query: 'Query B' }));

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBeDefined();
    expect(sessions[0].query).toBeDefined();
  });

  it('should delete a checkpoint', () => {
    const cp = createTestCheckpoint();
    store.save(cp);
    expect(store.load(cp.id)).toBeDefined();

    store.delete(cp.id);
    expect(store.load(cp.id)).toBeNull();
  });

  it('should delete all checkpoints for a session', () => {
    store.save(createTestCheckpoint({ id: 'cp-1', sessionId: 's1' }));
    store.save(createTestCheckpoint({ id: 'cp-2', sessionId: 's1' }));
    store.save(createTestCheckpoint({ id: 'cp-3', sessionId: 's2' }));

    store.deleteSession('s1');
    expect(store.listBySession('s1')).toHaveLength(0);
    expect(store.listBySession('s2')).toHaveLength(1);
  });

  it('should evict old checkpoints when at capacity', () => {
    const smallStore = new CheckpointStore({ dbPath: TEST_DB, maxCheckpointsPerSession: 3 });

    for (let i = 0; i < 5; i++) {
      smallStore.save(createTestCheckpoint({ id: `cp-${i}`, updatedAt: i * 1000 }));
    }

    const checkpoints = smallStore.listBySession('session-1');
    expect(checkpoints.length).toBeLessThanOrEqual(3);
    // Should keep the most recent ones
    expect(checkpoints[0].id).toBe('cp-4');

    smallStore.close();
  });

  it('should update an existing checkpoint', () => {
    const cp = createTestCheckpoint({ status: 'running' });
    store.save(cp);

    const updated = { ...cp, status: 'completed' as const, updatedAt: Date.now() + 1000 };
    store.save(updated);

    const loaded = store.load(cp.id);
    expect(loaded!.status).toBe('completed');
  });

  it('should return null for non-existent checkpoint', () => {
    expect(store.load('non-existent')).toBeNull();
  });

  it('should return null for non-existent session', () => {
    expect(store.loadLatest('non-existent')).toBeNull();
  });

  it('should preserve messages, plan, and file changes', () => {
    const cp = createTestCheckpoint({
      messages: [
        { role: 'user', content: 'Fix auth', timestamp: 100 },
        { role: 'assistant', content: 'Reading file...', timestamp: 200 },
        { role: 'tool', content: 'file content', toolName: 'read_file', timestamp: 300 },
      ],
      currentPlan: ['Step 1', 'Step 2', 'Step 3'],
      completedSteps: ['Step 1'],
      filesRead: ['/workspace/auth.ts'],
      fileChanges: [
        { filePath: '/workspace/auth.ts', oldContent: 'old', newContent: 'new', timestamp: 500 },
      ],
    });

    store.save(cp);
    const loaded = store.load(cp.id)!;

    expect(loaded.messages).toHaveLength(3);
    expect(loaded.messages[0].content).toBe('Fix auth');
    expect(loaded.currentPlan).toEqual(['Step 1', 'Step 2', 'Step 3']);
    expect(loaded.completedSteps).toEqual(['Step 1']);
    expect(loaded.filesRead).toEqual(['/workspace/auth.ts']);
    expect(loaded.fileChanges).toHaveLength(1);
    expect(loaded.fileChanges[0].filePath).toBe('/workspace/auth.ts');
  });
});
