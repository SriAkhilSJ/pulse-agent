// packages/frontend/src/components/Chat/ToolCallCard.tsx
import React, { memo } from 'react';
import type { ToolCall } from '../../store/agent-store.js';

interface ToolCallCardProps {
  call: ToolCall;
}

export const ToolCallCard = memo(function ToolCallCard({ call }: ToolCallCardProps) {
  const statusIcon = call.status === 'running' ? '⏳' : call.status === 'done' ? '✅' : '❌';

  return (
    <div className={`tool-card tool-card--${call.status}`}>
      <div className="tool-card__header">
        <span className="tool-card__icon">{statusIcon}</span>
        <span className="tool-card__name">{call.tool}</span>
        {call.duration !== undefined && call.duration > 0 && (
          <span className="tool-card__duration">{(call.duration / 1000).toFixed(1)}s</span>
        )}
      </div>
      {call.result && (
        <div className="tool-card__result">
          <pre>{call.result}</pre>
        </div>
      )}
    </div>
  );
});
