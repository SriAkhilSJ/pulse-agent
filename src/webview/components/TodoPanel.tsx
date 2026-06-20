// src/webview/components/TodoPanel.tsx
// Plan Mode UI — renders the task list / plan progress
// Based on Hermes todo_tool.py TodoStore

import React, { useState, useCallback } from 'react';
import { TodoItem } from '../agent-api';
import { IconCheck, IconCircle, IconX, IconChevronDown, IconChevronRight, IconClipboard, IconPlay } from './Icons';

export interface TodoPanelProps {
  todos: TodoItem[];
  onUpdate?: (todos: TodoItem[]) => void;
  readonly?: boolean;
}

export function TodoPanel({ todos, onUpdate, readonly }: TodoPanelProps) {
  console.log('[CARD][TodoPanel] render', { todoCount: todos.length, pending: todos.filter(t => t.status === 'pending').length, inProgress: todos.filter(t => t.status === 'in_progress').length, completed: todos.filter(t => t.status === 'completed').length, cancelled: todos.filter(t => t.status === 'cancelled').length, readonly });
  const [expanded, setExpanded] = useState(true);

  const pending = todos.filter(t => t.status === 'pending').length;
  const inProgress = todos.filter(t => t.status === 'in_progress').length;
  const completed = todos.filter(t => t.status === 'completed').length;
  const cancelled = todos.filter(t => t.status === 'cancelled').length;
  const total = todos.length;

  const handleStatusChange = useCallback((id: string, status: TodoItem['status']) => {
    if (readonly || !onUpdate) return;
    const next = todos.map(t => t.id === id ? { ...t, status } : t);
    onUpdate(next);
  }, [todos, onUpdate, readonly]);

  const getStatusIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed': return <IconCheck size={12} color="#22c55e" />;
      case 'in_progress': return <IconPlay size={10} color="var(--pc-accent)" />;
      case 'cancelled': return <IconX size={11} color="#f14c4c" />;
      default: return <IconCircle size={11} color="var(--pc-text-faint)" />;
    }
  };

  const getStatusColor = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'in_progress': return 'var(--pc-accent)';
      case 'cancelled': return '#f14c4c';
      default: return 'var(--pc-text-faint)';
    }
  };

  if (total === 0) return null;

  return (
    <div className="todo-panel">
      {/* Header */}
      <div className="todo-panel-header" onClick={() => setExpanded(!expanded)}>
        <div className="todo-panel-header-left">
          <span className="todo-panel-icon"><IconClipboard size={13} color="var(--pc-accent)" /></span>
          <span className="todo-panel-title">Task List</span>
          <span className="todo-panel-count">
            {inProgress > 0 && <span className="todo-count in-progress">{inProgress} active</span>}
            {pending > 0 && <span className="todo-count pending">{pending} pending</span>}
            {completed > 0 && <span className="todo-count completed">{completed} done</span>}
          </span>
        </div>
        <span className="todo-panel-chevron">{expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}</span>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="todo-panel-progress">
          <div className="todo-panel-progress-bar">
            <div
              className="todo-panel-progress-fill completed"
              style={{ width: `${(completed / total) * 100}%` }}
            />
            <div
              className="todo-panel-progress-fill in-progress"
              style={{ width: `${(inProgress / total) * 100}%` }}
            />
          </div>
          <span className="todo-panel-progress-label">
            {completed}/{total} completed
          </span>
        </div>
      )}

      {/* Todo items */}
      {expanded && (
        <div className="todo-panel-items">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className={`todo-panel-item status-${todo.status}`}
            >
              <button
                className="todo-panel-item-status"
                onClick={() => {
                  if (readonly) return;
                  const nextStatus: TodoItem['status'] =
                    todo.status === 'pending' ? 'in_progress' :
                    todo.status === 'in_progress' ? 'completed' :
                    todo.status === 'completed' ? 'pending' : 'pending';
                  handleStatusChange(todo.id, nextStatus);
                }}
                disabled={readonly}
                style={{ color: getStatusColor(todo.status) }}
                title={`Status: ${todo.status} (click to cycle)`}
              >
                {getStatusIcon(todo.status)}
              </button>
              <span className={`todo-panel-item-content ${todo.status === 'completed' ? 'completed' : ''}`}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
