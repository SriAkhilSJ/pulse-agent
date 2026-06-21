// packages/frontend/src/App.tsx
// PulseCode AI IDE — keeps original layout, improved agentic interface

import React, { useState, useCallback } from 'react';
import { ChatPanel } from './components/Chat/ChatPanel.js';
import { StatusBar } from './components/StatusBar/StatusBar.js';
import { MonacoEditor } from './components/Editor/MonacoEditor.js';
import { FileTree } from './components/FileTree/FileTree.js';
import { useAgentStore } from './store/agent-store.js';
import { useFileStore } from './store/file-store.js';
import './styles.css';

export function App() {
  const { sessionCost, isStreaming, status } = useAgentStore();
  const { activeFile, activeFileContent } = useFileStore();
  const [editorContent, setEditorContent] = useState('');

  const handleFileOpen = useCallback((filePath: string, content: string) => {
    setEditorContent(content);
  }, []);

  return (
    <div className="app">
      <div className="app-header">
        <h1>⚡ PulseCode AI</h1>
        <div className="app-header__right">
          {sessionCost > 0 && <span>${sessionCost.toFixed(4)}</span>}
          {isStreaming && <span className="streaming-dot">● {status}</span>}
        </div>
      </div>

      <div className="app-body">
        <div className="file-tree-sidebar">
          <FileTree onFileOpen={handleFileOpen} />
        </div>

        <div className="editor-area">
          {activeFile ? (
            <MonacoEditor
              filePath={activeFile}
              content={editorContent}
              onContentChange={setEditorContent}
            />
          ) : (
            <div className="editor-placeholder">
              <h2>⚡ PulseCode AI</h2>
              <p>Select a file or ask the agent to create one.</p>
            </div>
          )}
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
