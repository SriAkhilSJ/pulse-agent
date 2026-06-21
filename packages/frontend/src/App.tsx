// packages/frontend/src/App.tsx
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
  const { activeFile, activeFileContent, setActiveFileContent } = useFileStore();
  const [editorContent, setEditorContent] = useState('');

  const handleFileOpen = useCallback((filePath: string, content: string) => {
    setEditorContent(content);
  }, []);

  const handleContentChange = useCallback((content: string) => {
    setEditorContent(content);
    setActiveFileContent(content);
  }, [setActiveFileContent]);

  return (
    <div className="app">
      <div className="app-header">
        <h1>⚡ PulseCode AI</h1>
        <div className="app-header__right">
          {sessionCost > 0 && <span className="app-header__cost">${sessionCost.toFixed(4)}</span>}
          {isStreaming && <span className="app-header__streaming">● {status}</span>}
        </div>
      </div>

      <div className="app-body">
        {/* File tree sidebar */}
        <div className="file-tree-sidebar">
          <FileTree onFileOpen={handleFileOpen} />
        </div>

        {/* Editor area */}
        <div className="editor-area">
          {activeFile ? (
            <MonacoEditor
              filePath={activeFile}
              content={editorContent}
              onContentChange={handleContentChange}
            />
          ) : (
            <div className="editor-placeholder">
              <h2>⚡ PulseCode AI</h2>
              <p>Select a file from the explorer or ask the agent to create one.</p>
              <div className="editor-placeholder__shortcuts">
                <p><strong>Quick actions:</strong></p>
                <p>• "Create a new React component"</p>
                <p>• "Fix the bug in auth.ts"</p>
                <p>• "Add tests for utils.ts"</p>
                <p>• "Generate an image of a cat"</p>
                <p>• "Take a screenshot and analyze it"</p>
              </div>
              {isStreaming && (
                <div className="editor-placeholder__status">
                  <span className="pulse-dot" /> {status}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat sidebar */}
        <div className="chat-sidebar">
          <ChatPanel />
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

export default App;
