// packages/frontend/src/components/Editor/InlineSuggestionProvider.tsx
// Inline Suggestion Provider — ghost text for autocomplete using Monaco decorations

import React, { useEffect, useRef, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import type { editor, IDisposable } from 'monaco-editor';
import { useAgentStore } from '../../store/agent-store.js';

interface InlineSuggestionProviderProps {
  editor: editor.IStandaloneCodeEditor | null;
  enabled?: boolean;
}

export function InlineSuggestionProvider({ editor, enabled = true }: InlineSuggestionProviderProps) {
  const { status } = useAgentStore();
  const suggestionRef = useRef('');
  const decorationRef = useRef<string[]>([]);
  const keybindingRef = useRef<IDisposable | null>(null);

  const clearGhostText = useCallback(() => {
    if (!editor) return;
    if (decorationRef.current.length > 0) {
      editor.deltaDecorations(decorationRef.current, []);
      decorationRef.current = [];
    }
    suggestionRef.current = '';
  }, [editor]);

  // Show ghost text as a decoration
  const showGhostText = useCallback((text: string) => {
    if (!editor || !enabled) return;
    clearGhostText();

    const position = editor.getPosition();
    if (!position) return;

    const newDecorations = editor.deltaDecorations([], [{
      range: {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      },
      options: {
        after: { content: text, inlineClassName: 'inline-suggestion-ghost' },
        showIfCollapsed: true,
      },
    }]);

    decorationRef.current = newDecorations;
    suggestionRef.current = text;
  }, [editor, enabled, clearGhostText]);

  // Listen for status changes
  useEffect(() => {
    if (!enabled) return;
    if (status !== 'autocomplete' && !status.includes('suggest')) {
      clearGhostText();
    }
  }, [status, enabled, clearGhostText]);

  // Handle Tab key to accept suggestion
  useEffect(() => {
    if (!editor || !enabled) return;

    keybindingRef.current = editor.onKeyDown((e) => {
      if (e.keyCode === monaco.KeyCode.Tab && suggestionRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const position = editor.getPosition();
        if (position) {
          editor.executeEdits('inline-suggestion', [{
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
            text: suggestionRef.current,
          }]);
          clearGhostText();
        }
      }
    });

    return () => {
      if (keybindingRef.current) {
        keybindingRef.current.dispose();
        keybindingRef.current = null;
      }
    };
  }, [editor, enabled, clearGhostText]);

  return null;
}

export function useInlineSuggestions() {
  const suggestionRef = useRef('');

  const showSuggestion = useCallback((text: string) => {
    suggestionRef.current = text;
  }, []);

  const clearSuggestion = useCallback(() => {
    suggestionRef.current = '';
  }, []);

  const getSuggestion = useCallback(() => {
    return suggestionRef.current;
  }, []);

  return { showSuggestion, clearSuggestion, getSuggestion };
}
