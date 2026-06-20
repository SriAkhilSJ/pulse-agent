// packages/backend/src/checkpoint/checkpoint-store.ts
// Checkpoint Store — SQLite-based session persistence for crash recovery

import Database from 'better-sqlite3';
import type { Checkpoint, CheckpointConfig, CheckpointMessage, CheckpointFileChange } from '@pulse-ide/shared';
import { getDefaultCheckpointConfig } from '@pulse-ide/shared';

export class CheckpointStore {
  private db: Database.Database;
  private config: CheckpointConfig;

  constructor(config?: Partial<CheckpointConfig>) {
    this.config = { ...getDefaultCheckpointConfig(), ...config };
    this.db = new Database(this.config.dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        query TEXT NOT NULL,
        route TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        messages TEXT DEFAULT '[]',
        current_plan TEXT DEFAULT '[]',
        completed_steps TEXT DEFAULT '[]',
        files_read TEXT DEFAULT '[]',
        file_changes TEXT DEFAULT '[]',
        iteration INTEGER DEFAULT 0,
        max_iterations INTEGER DEFAULT 10,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_session ON checkpoints(session_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_updated ON checkpoints(updated_at);
    `);
  }

  /** Save a checkpoint */
  save(checkpoint: Checkpoint): void {
    // Evict old checkpoints if at capacity
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM checkpoints WHERE session_id = ?').get(checkpoint.sessionId) as any).c;
    if (count >= this.config.maxCheckpointsPerSession) {
      this.db.prepare(
        'DELETE FROM checkpoints WHERE session_id = ? AND id NOT IN (SELECT id FROM checkpoints WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?)'
      ).run(checkpoint.sessionId, checkpoint.sessionId, this.config.maxCheckpointsPerSession - 1);
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints
      (id, session_id, query, route, status, messages, current_plan, completed_steps, files_read, file_changes, iteration, max_iterations, created_at, updated_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id,
      checkpoint.sessionId,
      checkpoint.query,
      checkpoint.route,
      checkpoint.status,
      JSON.stringify(checkpoint.messages),
      JSON.stringify(checkpoint.currentPlan),
      JSON.stringify(checkpoint.completedSteps),
      JSON.stringify(checkpoint.filesRead),
      JSON.stringify(checkpoint.fileChanges),
      checkpoint.iteration,
      checkpoint.maxIterations,
      checkpoint.createdAt,
      checkpoint.updatedAt,
      checkpoint.error || null,
    );
  }

  /** Load a checkpoint by ID */
  load(checkpointId: string): Checkpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
    if (!row) return null;
    return this.rowToCheckpoint(row);
  }

  /** Load the latest checkpoint for a session */
  loadLatest(sessionId: string): Checkpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1').get(sessionId) as any;
    if (!row) return null;
    return this.rowToCheckpoint(row);
  }

  /** List all checkpoints for a session */
  listBySession(sessionId: string): Checkpoint[] {
    const rows = this.db.prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY updated_at DESC').all(sessionId) as any[];
    return rows.map(r => this.rowToCheckpoint(r));
  }

  /** List all sessions with their latest checkpoint */
  listSessions(): Array<{ sessionId: string; query: string; status: string; updatedAt: number }> {
    const rows = this.db.prepare(`
      SELECT session_id, query, status, updated_at
      FROM checkpoints
      WHERE id IN (
        SELECT id FROM checkpoints c1
        WHERE updated_at = (
          SELECT MAX(updated_at) FROM checkpoints c2 WHERE c2.session_id = c1.session_id
        )
      )
      ORDER BY updated_at DESC
    `).all() as any[];
    return rows.map(r => ({
      sessionId: r.session_id,
      query: r.query,
      status: r.status,
      updatedAt: r.updated_at,
    }));
  }

  /** Delete a checkpoint */
  delete(checkpointId: string): void {
    this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(checkpointId);
  }

  /** Delete all checkpoints for a session */
  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM checkpoints WHERE session_id = ?').run(sessionId);
  }

  /** Convert DB row to Checkpoint */
  private rowToCheckpoint(row: any): Checkpoint {
    return {
      id: row.id,
      sessionId: row.session_id,
      query: row.query,
      route: row.route as Checkpoint['route'],
      status: row.status as Checkpoint['status'],
      messages: JSON.parse(row.messages) as CheckpointMessage[],
      currentPlan: JSON.parse(row.current_plan),
      completedSteps: JSON.parse(row.completed_steps),
      filesRead: JSON.parse(row.files_read),
      fileChanges: JSON.parse(row.file_changes) as CheckpointFileChange[],
      iteration: row.iteration,
      maxIterations: row.max_iterations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error || undefined,
    };
  }

  /** Close the database */
  close(): void {
    this.db.close();
  }
}
