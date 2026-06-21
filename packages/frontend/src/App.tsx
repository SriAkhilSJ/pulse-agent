// packages/frontend/src/App.tsx
import React, { useState } from 'react';
import { ChatPanel } from './components/Chat/ChatPanel.js';
import { StatusBar } from './components/StatusBar/StatusBar.js';
import { MonacoEditor } from './components/Editor/MonacoEditor.js';
import { FileTree } from './components/FileTree/FileTree.js';
import { DiffViewer } from './components/Diff/DiffViewer.js';
import { useAgentStore } from './store/agent-store.js';
import './styles.css';

export function App() {
  const { sessionCost, isStreaming, pendingDiff, status, acceptDiff, rejectDiff } = useAgentStore();
  const [activeFile, setActiveFile] = useState<string | undefined>();

  const handleFileOpen = (filePath: string) => {
    setActiveFile(filePath);
  };

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
        {/* File tree sidebar */}
        <div className="file-tree-sidebar">
          <FileTree onFileOpen={handleFileOpen} />
        </div>

        {/* Editor area */}
        <div className="editor-area">
          <MonacoEditor filePath={activeFile} />
        </div>

        {/* Chat sidebar */}
        <div className="chat-sidebar">
          <ChatPanel />
        </div>
      </div>

      {/* Diff viewer modal */}
      {pendingDiff && (
        <div className="diff-modal">
          <DiffViewer diff={pendingDiff} onAccept={acceptDiff} onReject={rejectDiff} />
        </div>
      )}

      <StatusBar />
    </div>
  );
}

export default App;
