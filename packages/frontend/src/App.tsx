// packages/frontend/src/App.tsx — PulseCode AI Agent (purple/black theme)
// Matches the pulse-agent webview design exactly

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAgentStore } from './store/agent-store.js';
import { useFileStore } from './store/file-store.js';
import { useAgent } from './hooks/useAgent.js';
import './styles/pulse-ink.css';

export function App() {
  const { messages, status, isStreaming, error, sessionCost } = useAgentStore();
  const { activeFile, activeFileContent } = useFileStore();
  const { sendQuery, stopQuery } = useAgent();
  const [input, setInput] = useState('');
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div className="app" data-theme="pulse-ink">
      {/* Sidebar */}
      <div className="sidebar">

        {/* Task Header */}
        <div className="task-header">
          <div className="task-header-top">
            <span data-slot="task-header-title">⚡ PulseCode AI</span>
            {sessionCost > 0 && <span className="cost-badge">${sessionCost.toFixed(4)}</span>}
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages-wrapper">
          <div className="message-list">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {/* Breathing indicator while streaming */}
            {isStreaming && !messages.some(m => m.role === 'assistant' && m.content) && (
              <BreathingIndicator label={status} />
            )}

            {error && (
              <div className="error-banner">❌ {error}</div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-area">
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? 'Agent is working...' : 'Ask PulseCode...'}
            rows={3}
            disabled={isStreaming}
          />
          <div className="input-actions">
            {isStreaming ? (
              <button className="stop-btn" onClick={stopQuery}>⏹ Stop</button>
            ) : (
              <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>➤ Send</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: { id: string; role: string; content: string } }) {
  if (message.role === 'user') {
    return (
      <div className="turn-user">
        <div className="user-bubble">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="turn-assistant">
      <StreamingText text={message.content} isStreaming={false} />
    </div>
  );
}

function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <div className={`part-text ${isStreaming ? 'streaming' : ''}`}>
      <p>{text}<span className={isStreaming ? 'stream-cursor' : ''} /></p>
    </div>
  );
}

function BreathingIndicator({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className={`breathing ${done ? 'done' : ''}`}>
      <span className="breathing-dots"><i /><i /><i /></span>
      <span className="breathing-label">{label}</span>
    </div>
  );
}

export default App;
