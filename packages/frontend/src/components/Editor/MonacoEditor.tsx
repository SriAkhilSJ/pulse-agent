// packages/frontend/src/components/Editor/MonacoEditor.tsx
// Monaco Editor component — code editing with diff support and inline suggestions

import React, { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAgentStore } from '../../store/agent-store.js';

interface MonacoEditorProps {
  filePath?: string;
  language?: string;
  readOnly?: boolean;
}

export function MonacoEditor({ filePath, language, readOnly = false }: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState('');
  const [isApplyingDiff, setIsApplyingDiff] = useState(false);
  const { pendingDiff, acceptDiff, rejectDiff } = useAgentStore();

  // Handle editor mount
  const handleEditorDidMount = useCallback((editor: editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;

    // Configure editor for IDE-like experience
    editor.updateOptions({
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

  // Apply diff from agent
  const applyDiff = useCallback((oldContent: string, newContent: string) => {
    const editor = editorRef.current;
    if (!editor || isApplyingDiff) return;

    setIsApplyingDiff(true);
    const model = editor.getModel();
    if (!model) {
      setIsApplyingDiff(false);
      return;
    }

    // Compute diff and apply edits
    const edits = computeTextEdits(model, oldContent, newContent);
    if (edits.length > 0) {
      editor.pushUndoStop();
      model.applyEdits(edits);
      editor.pushUndoStop();
    }

    setIsApplyingDiff(false);
  }, [isApplyingDiff]);

  // Handle pending diff from agent
  useEffect(() => {
    if (pendingDiff && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        applyDiff(pendingDiff.oldContent, pendingDiff.newContent);
      }
    }
  }, [pendingDiff, applyDiff]);

  // Handle accept/reject
  const handleAccept = useCallback(() => {
    acceptDiff();
  }, [acceptDiff]);

  const handleReject = useCallback(() => {
    // Revert the last set of edits
    const editor = editorRef.current;
    if (editor) {
      editor.trigger('keyboard', 'undo', null);
    }
    rejectDiff();
  }, [rejectDiff]);

  return (
    <div className="monaco-editor-container">
      {filePath && (
        <div className="monaco-editor__tab">
          <span className="monaco-editor__filename">{filePath.split('/').pop()}</span>
          <span className="monaco-editor__path">{filePath}</span>
        </div>
      )}

      <Editor
        height="100%"
        language={language || 'typescript'}
        value={content}
        onChange={(value) => setContent(value || '')}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          domReadOnly: readOnly,
        }}
        theme="vs-dark"
      />

      {/* Diff approval overlay */}
      {pendingDiff && (
        <div className="monaco-editor__diff-overlay">
          <div className="monaco-editor__diff-bar">
            <span>🤖 AI wants to edit this file</span>
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

// Compute text edits between old and new content
function computeTextEdits(
  model: editor.ITextModel,
  oldContent: string,
  newContent: string
): editor.IIdentifiedSingleEditOperation[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const edits: editor.IIdentifiedSingleEditOperation[] = [];

  // Simple line-by-line diff
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';

    if (oldLine !== newLine) {
      const startLine = i + 1;
      const endLine = i + 1;

      if (i >= oldLines.length) {
        // Insert new line
        edits.push({
          range: {
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: startLine,
            endColumn: 1,
          },
          text: newLine + '\n',
        });
      } else if (i >= newLines.length) {
        // Delete line
        edits.push({
          range: {
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: startLine + 1,
            endColumn: 1,
          },
          text: null,
        });
      } else {
        // Replace line
        edits.push({
          range: {
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: startLine,
            endColumn: oldLine.length + 1,
          },
          text: newLine,
        });
      }
    }
  }

  return edits;
}
