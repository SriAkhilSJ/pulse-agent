// packages/frontend/src/components/Diff/DiffViewer.tsx
// DiffViewer — side-by-side diff using Monaco editor

import React, { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { PendingDiff } from '../../store/agent-store.js';

interface DiffViewerProps {
  diff: PendingDiff;
  onAccept: () => void;
  onReject: () => void;
}

export function DiffViewer({ diff, onAccept, onReject }: DiffViewerProps) {
  const oldEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const newEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleOldMount = (editor: editor.IStandaloneCodeEditor) => {
    oldEditorRef.current = editor;
    editor.updateOptions({ readOnly: true, minimap: { enabled: false } });
  };

  const handleNewMount = (editor: editor.IStandaloneCodeEditor) => {
    newEditorRef.current = editor;
    editor.updateOptions({ readOnly: true, minimap: { enabled: false } });
  };

  // Detect language from file extension
  const language = getLanguageFromPath(diff.filePath);

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header">
        <span className="diff-viewer__file">{diff.filePath}</span>
        <span className="diff-viewer__explanation">{diff.explanation}</span>
      </div>

      <div className="diff-viewer__body">
        <div className="diff-viewer__pane diff-viewer__pane--old">
          <div className="diff-viewer__pane-header">Before</div>
          <Editor
            height="300px"
            language={language}
            value={diff.oldContent}
            onMount={handleOldMount}
            options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            theme="vs-dark"
          />
        </div>
        <div className="diff-viewer__pane diff-viewer__pane--new">
          <div className="diff-viewer__pane-header">After</div>
          <Editor
            height="300px"
            language={language}
            value={diff.newContent}
            onMount={handleNewMount}
            options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            theme="vs-dark"
          />
        </div>
      </div>

      <div className="diff-viewer__actions">
        <button className="diff-viewer__reject" onClick={onReject}>
          ❌ Reject
        </button>
        <button className="diff-viewer__accept" onClick={onAccept}>
          ✅ Accept
        </button>
      </div>
    </div>
  );
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python', java: 'java',
    go: 'go', rs: 'rust',
    c: 'c', cpp: 'cpp', cs: 'csharp',
    html: 'html', css: 'css', scss: 'scss',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sh: 'shell', bash: 'shell',
    sql: 'sql',
  };
  return langMap[ext || ''] || 'plaintext';
}
