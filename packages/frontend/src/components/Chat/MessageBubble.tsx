// packages/frontend/src/components/Chat/MessageBubble.tsx
import React, { memo } from 'react';
import type { ChatMessage } from '../../store/agent-store.js';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  return (
    <div className={`msg-bubble msg-bubble--${isUser ? 'user' : isTool ? 'tool' : 'assistant'}`}>
      <div className="msg-role">
        {isUser ? '👤 You' : isTool ? `🔧 ${message.toolName || 'Tool'}` : '🤖 Pulse'}
      </div>
      <div className="msg-content">
        {isTool ? (
          <pre className="msg-tool-result">{message.content}</pre>
        ) : (
          <div className="msg-text">{message.content}</div>
        )}
      </div>
    </div>
  );
});
