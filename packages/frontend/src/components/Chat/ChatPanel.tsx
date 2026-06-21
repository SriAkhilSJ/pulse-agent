// packages/frontend/src/components/Chat/ChatPanel.tsx
// Agentic interface — streaming, tool cards, breathing indicator

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAgentStore } from '../../store/agent-store.js';
import { useAgent } from '../../hooks/useAgent.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallCard } from './ToolCallCard.js';

export function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, status, currentToolCalls, pendingDiff, isStreaming, error } = useAgentStore();
  const { sendQuery, stopQuery, acceptDiff, rejectDiff } = useAgent();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    sendQuery(input);
    setInput('');
  }, [input, isStreaming, sendQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="chat-panel">
      {/* Status bar */}
      <div className="chat-status">
        {isStreaming && <span className="status-dot running" />}
        <span className="status-text">{status}</span>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Tool calls */}
        {currentToolCalls.filter((c) => c.status === 'running').map((call) => (
          <ToolCallCard key={call.id} call={call} />
        ))}

        {/* Breathing indicator while streaming with no content yet */}
        {isStreaming && !messages.some(m => m.role === 'assistant' && m.content) && (
          <div className="breathing">
            <span className="breathing-dots"><i /><i /><i /></span>
            <span className="breathing-label">{status}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="chat-error">❌ {error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Diff approval */}
      {pendingDiff && (
        <div className="diff-approval">
          <span>🤖 Edit {pendingDiff.filePath}</span>
          <div className="diff-actions">
            <button className="btn-reject" onClick={rejectDiff}>❌</button>
            <button className="btn-accept" onClick={acceptDiff}>✅</button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Agent working...' : 'Ask PulseCode...'}
          rows={3}
          disabled={isStreaming}
        />
        <div className="input-actions">
          {isStreaming ? (
            <button className="btn-stop" onClick={stopQuery}>⏹ Stop</button>
          ) : (
            <button className="btn-send" onClick={handleSend} disabled={!input.trim()}>
              ➤ Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
