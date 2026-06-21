// packages/frontend/src/components/Editor/MonacoEditor.tsx
// Monaco Editor — code editing with real agent integration

import React, { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAgentStore } from '../../store/agent-store.js';
import { InlineSuggestionProvider } from './InlineSuggestionProvider.js';

interface MonacoEditorProps {
  filePath?: string;
  content?: string;
  language?: string;
  readOnly?: boolean;
  onContentChange?: (content: string) => void;
}

export function MonacoEditor({ filePath, content: initialContent, language, readOnly = false, onContentChange }: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState(initialContent || '');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const { pendingDiff, acceptDiff, rejectDiff, isStreaming, status } = useAgentStore();

  // Update content when filePath changes
  useEffect(() => {
    setContent(initialContent || '');
    setHasUnsavedChanges(false);
  }, [filePath, initialContent]);

  const handleEditorDidMount = useCallback((editorInstance: editor.IStandaloneCodeEditor) => {
    editorRef.current = editorInstance;
    editorInstance.updateOptions({
      minimap: { enabled: true },
      fontSize: 13,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'on',
      tabSize: 2,
      wordWrap: 'on',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
    });
  }, []);

  const handleChange = useCallback((value: string | undefined) => {
    const newContent = value || '';
    setContent(newContent);
    setHasUnsavedChanges(true);
    onContentChange?.(newContent);
  }, [onContentChange]);

  // Apply diff from agent
  useEffect(() => {
    if (pendingDiff && editorRef.current && pendingDiff.newContent) {
      const editor = editorRef.current;
      const model = editor.getModel();
      if (model) {
        // Show the new content in the editor as a preview
        const fullRange = model.getFullModelRange();
        editor.executeEdits('agent-diff', [{
          range: fullRange,
          text: pendingDiff.newContent,
        }]);
        setHasUnsavedChanges(true);
      }
    }
  }, [pendingDiff]);

  const handleAccept = useCallback(() => {
    acceptDiff();
    setHasUnsavedChanges(false);
  }, [acceptDiff]);

  const handleReject = useCallback(() => {
    // Revert to original content
    if (editorRef.current && initialContent !== undefined) {
      const model = editorRef.current.getModel();
      if (model) {
        const fullRange = model.getFullModelRange();
        editorRef.current.executeEdits('agent-revert', [{
          range: fullRange,
          text: initialContent,
        }]);
      }
    }
    rejectDiff();
    setHasUnsavedChanges(false);
  }, [rejectDiff, initialContent]);

  // Track cursor position for inline suggestions
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number } | null>(null);
  useEffect(() => {
    if (!editorRef.current) return;
    const disposable = editorRef.current.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column });
    });
    return () => disposable.dispose();
  }, []);

  const detectLanguage = useCallback((path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript',
      py: 'python', go: 'go', rs: 'rust', java: 'java',
      c: 'c', cpp: 'cpp', cs: 'csharp',
      html: 'html', css: 'css', scss: 'scss',
      json: 'json', yaml: 'yaml', yml: 'yaml',
      md: 'markdown', sh: 'shell', bash: 'shell',
      sql: 'sql', toml: 'toml',
    };
    return langMap[ext || ''] || 'plaintext';
  }, []);

  return (
    <div className="monaco-editor-container">
      {/* Tab bar */}
      {filePath && (
        <div className="monaco-editor__tab">
          <span className="monaco-editor__filename">
            {hasUnsavedChanges ? '● ' : ''}{filePath.split('/').pop()}
          </span>
          <span className="monaco-editor__path">{filePath}</span>
          {isStreaming && <span className="monaco-editor__streaming">●</span>}
        </div>
      )}

      {/* Editor */}
      <Editor
        height="100%"
        language={language || (filePath ? detectLanguage(filePath) : 'typescript')}
        value={content}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          domReadOnly: readOnly,
        }}
        theme="vs-dark"
      />

      {/* Inline suggestion provider */}
      <InlineSuggestionProvider editor={editorRef.current} enabled={!readOnly} />

      {/* Diff approval overlay */}
      {pendingDiff && (
        <div className="monaco-editor__diff-overlay">
          <div className="monaco-editor__diff-bar">
            <span>🤖 AI wants to edit {pendingDiff.filePath}</span>
            <div className="monaco-editor__diff-actions">
              <button className="monaco-editor__reject" onClick={handleReject}>
                ❌ Reject
              </button>
              <button className="monaco-editor__accept" onClick={handleAccept}>
                ✅ Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
