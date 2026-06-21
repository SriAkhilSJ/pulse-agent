// packages/frontend/src/components/Diff/DiffViewer.tsx
// DiffViewer — side-by-side diff display

import React, { memo } from 'react';
import type { PendingDiff } from '../../store/agent-store.js';

interface DiffViewerProps {
  diff: PendingDiff;
}

export const DiffViewer = memo(function DiffViewer({ diff }: DiffViewerProps) {
  const oldLines = diff.oldContent.split('\n');
  const newLines = diff.newContent.split('\n');

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header">
        <span className="diff-viewer__file">{diff.filePath}</span>
        <span className="diff-viewer__explanation">{diff.explanation}</span>
      </div>
      <div className="diff-viewer__body">
        <div className="diff-viewer__pane diff-viewer__pane--old">
          <div className="diff-viewer__pane-header">Before</div>
          <div className="diff-viewer__lines">
            {oldLines.map((line, i) => (
              <div key={i} className="diff-viewer__line diff-viewer__line--removed">
                <span className="diff-viewer__line-number">{i + 1}</span>
                <span className="diff-viewer__line-content">{line}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="diff-viewer__pane diff-viewer__pane--new">
          <div className="diff-viewer__pane-header">After</div>
          <div className="diff-viewer__lines">
            {newLines.map((line, i) => (
              <div key={i} className="diff-viewer__line diff-viewer__line--added">
                <span className="diff-viewer__line-number">{i + 1}</span>
                <span className="diff-viewer__line-content">{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
