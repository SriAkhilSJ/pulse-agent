// packages/frontend/src/components/Chat/MessageBubble.tsx
// MessageBubble — renders user/assistant/tool messages with markdown support

import React, { memo } from 'react';
import type { ChatMessage } from '../../store/agent-store.js';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';

  return (
    <div className={`message-bubble message-bubble--${message.role}`}>
      <div className="message-bubble__header">
        <span className="message-bubble__role">
          {isUser ? '👤 You' : isTool ? `🔧 ${message.toolName || 'Tool'}` : isSystem ? 'ℹ️ System' : '🤖 Pulse'}
        </span>
        <span className="message-bubble__time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="message-bubble__content">
        {isTool ? (
          <pre className="message-bubble__tool-result">{message.content}</pre>
        ) : (
          <div className="message-bubble__text">
            {message.content.split('\n').map((line, i) => {
              // Simple code block detection
              if (line.startsWith('```')) {
                return <div key={i} className="message-bubble__code-fence">{'```'}</div>;
              }
              if (line.startsWith('    ') || line.startsWith('\t')) {
                return <code key={i} className="message-bubble__inline-code">{line}</code>;
              }
              return <p key={i}>{line}</p>;
            })}
          </div>
        )}
      </div>
    </div>
  );
});
