// packages/frontend/src/App.tsx
import React from 'react';
import { ChatPanel } from './components/Chat/ChatPanel.js';
import { StatusBar } from './components/StatusBar/StatusBar.js';
import { useAgentStore } from './store/agent-store.js';
import './styles.css';

export function App() {
  const { sessionCost, isStreaming } = useAgentStore();

  return (
    <div className="app">
      <div className="app-header">
        <h1>PulseCode AI</h1>
        <div className="app-header__cost">
          {sessionCost > 0 && <span>${sessionCost.toFixed(4)}</span>}
          {isStreaming && <span className="app-header__streaming">●</span>}
        </div>
      </div>
      <div className="app-body">
        <div className="editor-area">
          <div className="editor-placeholder">
            <p>📝 Monaco Editor (coming soon)</p>
            <p>Open a file to start editing</p>
          </div>
        </div>
        <div className="chat-sidebar">
          <ChatPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
