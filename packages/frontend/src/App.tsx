// packages/frontend/src/App.tsx
import React from 'react';
import { ChatPanel } from './components/Chat/ChatPanel';
import { StatusBar } from './components/StatusBar/StatusBar';
import './styles.css';

export function App() {
  return (
    <div className="app">
      <div className="app-header">
        <h1>PulseCode AI IDE</h1>
      </div>
      <div className="app-body">
        <div className="editor-area">
          <div className="editor-placeholder">
            <p>Monaco Editor (coming soon)</p>
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
