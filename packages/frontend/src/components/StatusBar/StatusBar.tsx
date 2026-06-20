// packages/frontend/src/components/StatusBar/StatusBar.tsx
import React from 'react';
import { useAgentStore } from '../../store/agent-store';

export function StatusBar() {
  const { currentModel, provider, connected } = useAgentStore();

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <span className={`status-bar__indicator ${connected ? 'connected' : 'disconnected'}`} />
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <div className="status-bar__center">
        <span>{provider} / {currentModel}</span>
      </div>
      <div className="status-bar__right">
        <span>PulseCode AI IDE v0.1.0</span>
      </div>
    </div>
  );
}
