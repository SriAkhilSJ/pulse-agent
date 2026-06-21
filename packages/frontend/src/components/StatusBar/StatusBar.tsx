// packages/frontend/src/components/StatusBar/StatusBar.tsx
import React from 'react';
import { useAgentStore } from '../../store/agent-store.js';

export function StatusBar() {
  const { status, isStreaming, sessionCost, currentToolCalls } = useAgentStore();

  const runningTools = currentToolCalls.filter((c) => c.status === 'running').length;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <span className={`status-bar__indicator ${isStreaming ? 'streaming' : 'idle'}`} />
        <span>{status}</span>
      </div>
      <div className="status-bar__center">
        {runningTools > 0 && <span>⚙️ {runningTools} tool{runningTools > 1 ? 's' : ''} running</span>}
      </div>
      <div className="status-bar__right">
        {sessionCost > 0 && <span className="status-bar__cost">${sessionCost.toFixed(4)}</span>}
        <span>PulseCode AI IDE v0.1.0</span>
      </div>
    </div>
  );
}
