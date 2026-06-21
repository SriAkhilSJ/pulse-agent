// packages/frontend/src/components/Chat/ChatPanel.tsx
// ChatPanel — main chat interface with streaming, tool calls, and diff approval

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAgentStore } from '../../store/agent-store.js';
import { useAgent } from '../../hooks/useAgent.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallCard } from './ToolCallCard.js';
import { ApprovalDialog } from '../Diff/ApprovalDialog.js';

export function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, status, currentToolCalls, pendingDiff, isStreaming, error } = useAgentStore();
  const { sendQuery, stopQuery, acceptDiff, rejectDiff } = useAgent();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
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
      <div className="chat-panel__status">
        {isStreaming && <span className="chat-panel__status-dot" />}
        <span className="chat-panel__status-text">{status}</span>
      </div>

      {/* Messages */}
      <div className="chat-panel__messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Tool calls */}
        {currentToolCalls.filter((c) => c.status === 'running').map((call) => (
          <ToolCallCard key={call.id} call={call} />
        ))}

        {/* Error */}
        {error && (
          <div className="chat-panel__error">
            ❌ {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Diff approval dialog */}
      {pendingDiff && (
        <ApprovalDialog
          diff={pendingDiff}
          onAccept={acceptDiff}
          onReject={rejectDiff}
        />
      )}

      {/* Input */}
      <div className="chat-panel__input">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Agent is working...' : 'Ask PulseCode...'}
          rows={3}
          disabled={isStreaming}
        />
        <div className="chat-panel__actions">
          {isStreaming ? (
            <button className="chat-panel__stop" onClick={stopQuery}>
              ⏹ Stop
            </button>
          ) : (
            <button
              className="chat-panel__send"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              ➤ Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
