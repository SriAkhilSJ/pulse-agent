// src/webview/components/QuestionDock.tsx
// Ask Mode UI — renders clarifying questions from the AI inline above the prompt input

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AskUserQuestion } from '../agent-api';
import { IconHelpCircle, IconX, IconCircle, IconCircleFilled, IconCheck, IconSquare, IconCheckSquare } from './Icons';

export interface QuestionDockProps {
  request: AskUserQuestion;
  onReply: (answers: string[]) => void;
  onDismiss: () => void;
  disabled?: boolean;
}

export function QuestionDock({ request, onReply, onDismiss, disabled }: QuestionDockProps) {
  console.log('[CARD][QuestionDock] render', { requestId: request.requestId, question: request.question?.substring(0, 80), motive: request.motive?.substring(0, 80), optionCount: request.options?.length || 0, allowCustom: request.allowCustom, multiple: request.multiple, disabled });
  const [selected, setSelected] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { question, motive, options, allowCustom, multiple } = request;
  const hasSelection = selected.length > 0;
  const canSubmit = hasSelection || (showCustom && customInput.trim().length > 0);

  useEffect(() => {
    if (showCustom && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCustom]);

  const handleOptionClick = useCallback((option: string) => {
    if (disabled) return;
    if (multiple) {
      setSelected(prev =>
        prev.includes(option)
          ? prev.filter(o => o !== option)
          : [...prev, option]
      );
    } else {
      setSelected([option]);
    }
  }, [disabled, multiple]);

  const handleCustomSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || !customInput.trim()) return;
    if (multiple) {
      setSelected(prev =>
        prev.includes(customInput.trim())
          ? prev
          : [...prev, customInput.trim()]
      );
      setCustomInput('');
      setShowCustom(false);
    } else {
      onReply([customInput.trim()]);
    }
  }, [disabled, customInput, multiple, onReply]);

  const handleSubmit = useCallback(() => {
    if (disabled || !canSubmit) return;
    if (showCustom && customInput.trim() && !multiple) {
      onReply([customInput.trim()]);
    } else {
      onReply(selected);
    }
  }, [disabled, canSubmit, showCustom, customInput, multiple, selected, onReply]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  }, [handleSubmit, onDismiss]);

  const RadioIcon = ({ isSelected }: { isSelected: boolean }) => (
    isSelected
      ? <IconCircleFilled size={14} color="var(--pc-accent)" />
      : <IconCircle size={14} color="var(--pc-text-faint)" />
  );

  const CheckboxIcon = ({ isSelected }: { isSelected: boolean }) => (
    isSelected
      ? <IconCheckSquare size={14} color="var(--pc-accent)" />
      : <IconSquare size={14} color="var(--pc-text-faint)" />
  );

  return (
    <div
      className="question-dock"
      data-multiple={multiple ? 'true' : 'false'}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="question-dock-header">
        <div className="question-dock-header-left">
          <span className="question-dock-icon"><IconHelpCircle size={14} color="var(--pc-accent)" /></span>
          <span className="question-dock-title">{question}</span>
        </div>
        <button
          className="question-dock-dismiss"
          onClick={onDismiss}
          disabled={disabled}
          title="Dismiss (Esc)"
        >
          <IconX size={12} color="var(--pc-text-weak)" />
        </button>
      </div>

      {/* Motive */}
      {motive && (
        <div className="question-dock-motive">{motive}</div>
      )}

      {/* Options */}
      <div className="question-dock-options" role="radiogroup" aria-label={question}>
        {options.map((option, i) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={i}
              className={`question-dock-option ${isSelected ? 'selected' : ''}`}
              onClick={() => handleOptionClick(option)}
              disabled={disabled}
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={isSelected}
            >
              <span className={`question-dock-option-check ${multiple ? 'checkbox' : 'radio'}`}>
                {multiple
                  ? <CheckboxIcon isSelected={isSelected} />
                  : <RadioIcon isSelected={isSelected} />
                }
              </span>
              <span className="question-dock-option-label">{option}</span>
            </button>
          );
        })}

        {/* Custom input option */}
        {allowCustom && (
          <button
            className={`question-dock-option custom ${showCustom ? 'selected' : ''}`}
            onClick={() => setShowCustom(true)}
            disabled={disabled}
          >
            <span className={`question-dock-option-check ${multiple ? 'checkbox' : 'radio'}`}>
              {multiple
                ? <CheckboxIcon isSelected={showCustom} />
                : <RadioIcon isSelected={showCustom} />
              }
            </span>
            <span className="question-dock-option-label">
              {showCustom ? '' : 'Type your own answer...'}
            </span>
          </button>
        )}
      </div>

      {/* Custom input form */}
      {showCustom && (
        <form className="question-dock-custom-form" onSubmit={handleCustomSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="question-dock-custom-input"
            placeholder="Type your answer..."
            value={customInput}
            onChange={(e) => setCustomInput(e.currentTarget.value)}
            disabled={disabled}
          />
          <button
            type="submit"
            className="question-dock-custom-submit"
            disabled={disabled || !customInput.trim()}
          >
            {multiple ? 'Add' : 'Submit'}
          </button>
          <button
            type="button"
            className="question-dock-custom-cancel"
            onClick={() => { setShowCustom(false); setCustomInput(''); }}
            disabled={disabled}
          >
            Cancel
          </button>
        </form>
      )}

      {/* Footer */}
      <div className="question-dock-footer">
        <button
          className="question-dock-btn dismiss"
          onClick={onDismiss}
          disabled={disabled}
        >
          Dismiss
        </button>
        <div className="question-dock-footer-right">
          {multiple && hasSelection && (
            <span className="question-dock-selection-count">
              {selected.length} selected
            </span>
          )}
          <button
            className="question-dock-btn submit"
            onClick={handleSubmit}
            disabled={disabled || !canSubmit}
          >
            {multiple ? 'Submit' : 'Reply'}
          </button>
        </div>
      </div>
    </div>
  );
}
