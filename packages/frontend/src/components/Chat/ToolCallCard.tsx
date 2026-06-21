// packages/frontend/src/components/Chat/ToolCallCard.tsx
// ToolCallCard — displays tool call with args and result

import React, { memo, useState } from 'react';
import type { ToolCall } from '../../store/agent-store.js';

interface ToolCallCardProps {
  call: ToolCall;
}

export const ToolCallCard = memo(function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = call.status === 'running' ? '⏳' : call.status === 'done' ? '✅' : '❌';

  return (
    <div className={`tool-call-card tool-call-card--${call.status}`}>
      <div className="tool-call-card__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-card__status">{statusIcon}</span>
        <span className="tool-call-card__name">{call.tool}</span>
        <span className="tool-call-card__toggle">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="tool-call-card__body">
          <div className="tool-call-card__args">
            <strong>Args:</strong>
            <pre>{JSON.stringify(call.args, null, 2)}</pre>
          </div>
          {call.result && (
            <div className="tool-call-card__result">
              <strong>Result:</strong>
              <pre>{call.result}</pre>
            </div>
          )}
          {call.duration !== undefined && (
            <div className="tool-call-card__duration">
              ⏱️ {call.duration}ms
            </div>
          )}
        </div>
      )}
    </div>
  );
});
