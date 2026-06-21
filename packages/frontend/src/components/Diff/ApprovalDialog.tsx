// packages/frontend/src/components/Diff/ApprovalDialog.tsx
// ApprovalDialog — shows diff with Accept/Reject buttons

import React, { memo } from 'react';
import { DiffViewer } from './DiffViewer.js';
import type { PendingDiff } from '../../store/agent-store.js';

interface ApprovalDialogProps {
  diff: PendingDiff;
  onAccept: () => void;
  onReject: () => void;
}

export const ApprovalDialog = memo(function ApprovalDialog({ diff, onAccept, onReject }: ApprovalDialogProps) {
  return (
    <div className="approval-dialog">
      <div className="approval-dialog__overlay" />
      <div className="approval-dialog__content">
        <div className="approval-dialog__title">
          📝 AI wants to edit <code>{diff.filePath}</code>
        </div>

        <DiffViewer diff={diff} />

        <div className="approval-dialog__actions">
          <button
            className="approval-dialog__button approval-dialog__button--reject"
            onClick={onReject}
          >
            ❌ Reject
          </button>
          <button
            className="approval-dialog__button approval-dialog__button--accept"
            onClick={onAccept}
          >
            ✅ Accept
          </button>
        </div>
      </div>
    </div>
  );
});
