// src/webview/components/PermissionDock.tsx
// Permission approval UI — renders when AI needs approval for dangerous commands

import React, { useState, useCallback } from 'react';
import { PermissionRequest } from '../agent-api';
import { IconWarning, IconLock } from './Icons';

export interface PermissionDockProps {
  request: PermissionRequest;
  onDecide: (decision: 'once' | 'always' | 'deny') => void;
  disabled?: boolean;
}

export function PermissionDock({ request, onDecide, disabled }: PermissionDockProps) {
  console.log('[CARD][PermissionDock] render', { requestId: request.requestId, toolName: request.toolName, command: request.command?.substring(0, 80), patternCount: request.patterns?.length || 0, sessionId: request.sessionId, disabled });
  const { toolName, command, patterns } = request;

  const handleDecide = useCallback((decision: 'once' | 'always' | 'deny') => {
    if (disabled) return;
    onDecide(decision);
  }, [disabled, onDecide]);

  return (
    <div className="permission-dock">
      {/* Header */}
      <div className="permission-dock-header">
        <span className="permission-dock-icon"><IconWarning size={14} color="#febc2e" /></span>
        <span className="permission-dock-title">Permission Required</span>
        <span className="permission-dock-tool">{toolName}</span>
      </div>

      {/* Command / Pattern */}
      {command && (
        <div className="permission-dock-command">
          <code>{command}</code>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="permission-dock-patterns">
          {patterns.map((pattern, i) => (
            <div key={i} className="permission-dock-pattern">
              <span className="permission-dock-pattern-icon"><IconLock size={11} color="var(--pc-text-faint)" /></span>
              <code>{pattern}</code>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="permission-dock-footer">
        <button
          className="permission-dock-btn deny"
          onClick={() => handleDecide('deny')}
          disabled={disabled}
        >
          Deny
        </button>
        <div className="permission-dock-footer-right">
          <button
            className="permission-dock-btn always"
            onClick={() => handleDecide('always')}
            disabled={disabled}
          >
            Allow Always
          </button>
          <button
            className="permission-dock-btn once"
            onClick={() => handleDecide('once')}
            disabled={disabled}
          >
            Run Once
          </button>
        </div>
      </div>
    </div>
  );
}
