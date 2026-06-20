// packages/frontend/src/components/Chat/ChatPanel.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useAgentStore } from '../../store/agent-store';
import { useWebSocket } from '../../hooks/useWebSocket';

export function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, isStreaming, addMessage } = useAgentStore();
  const { sendMessage } = useWebSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const requestId = `req-${Date.now()}`;
    addMessage({
      id: requestId,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    });
    sendMessage(input, requestId);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-message__role">{msg.role}</div>
            <div className="chat-message__content">{msg.content}</div>
          </div>
        ))}
        {isStreaming && (
          <div className="chat-message chat-message--streaming">
            <div className="chat-message__content">Thinking...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask PulseCode..."
          rows={3}
          disabled={isStreaming}
        />
        <button onClick={handleSend} disabled={isStreaming || !input.trim()}>
          {isStreaming ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
