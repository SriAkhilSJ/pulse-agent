// src/telemetry.ts
// Telemetry — Usage tracking for PulseCode AI
// Tracks: sessions, tool usage, errors, performance

import * as vscode from 'vscode';

export interface TelemetryEvent {
  type: 'session_start' | 'session_end' | 'tool_call' | 'tool_error' | 'message_sent' | 'inline_suggestion' | 'mode_switch';
  timestamp: number;
  data: Record<string, unknown>;
}

export class Telemetry {
  private enabled: boolean;
  private sessionId: string;
  private eventBuffer: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sessionStart: number;

  constructor() {
    this.enabled = (process.env['PULSE_TELEMETRY'] || 'false').toLowerCase() === 'true';
    this.sessionId = 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
    this.sessionStart = Date.now();

    if (this.enabled) {
      this.startFlushTimer();
      this.track('session_start', { node_version: process.version, platform: process.platform });
    }
  }

  track(type: TelemetryEvent['type'], data: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    this.eventBuffer.push({
      type,
      timestamp: Date.now(),
      data: { ...data, session_id: this.sessionId },
    });

    // Flush immediately on errors
    if (type === 'tool_error') {
      this.flush();
    }
  }

  private startFlushTimer(): void {
    // Flush every 5 minutes
    this.flushTimer = setInterval(() => this.flush(), 5 * 60 * 1000);
  }

  private flush(): void {
    if (this.eventBuffer.length === 0) return;

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    // In production, send to your analytics endpoint
    // For now, log to output channel
    console.log('[Telemetry] Flushed ' + events.length + ' events');

    // Example: POST to telemetry endpoint
    // fetch(process.env['PULSE_TELEMETRY_URL'] || 'https://telemetry.pulsecode.ai/events', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ events }),
    // }).catch(() => {});
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionDuration(): number {
    return Date.now() - this.sessionStart;
  }

  dispose(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.track('session_end', { duration_ms: this.getSessionDuration() });
    this.flush();
  }
}
