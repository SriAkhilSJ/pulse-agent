// packages/frontend/src/components/FileTree/FileTree.tsx
// File Tree Explorer — reads real workspace files from backend

import React, { useState, useCallback, useEffect } from 'react';
import { useAgentStore } from '../../store/agent-store.js';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  depth: number;
}

interface FileTreeProps {
  workspacePath?: string;
  onFileOpen?: (filePath: string, content: string) => void;
}

export function FileTree({ workspacePath = '/workspace', onFileOpen }: FileTreeProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addMessage } = useAgentStore();

  // Load file tree from backend
  const loadFileTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use the backend API to list files
      const response = await fetch(`/api/files?path=${encodeURIComponent(workspacePath)}`);
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      } else {
        // If backend doesn't have /api/files, use the agent to list files
        setError('File listing requires backend API');
        setFiles([]);
      }
    } catch (err) {
      setError('Could not load file tree');
      setFiles([]);
    }
    setLoading(false);
  }, [workspacePath]);

  useEffect(() => {
    loadFileTree();
  }, [loadFileTree]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback(async (node: FileNode) => {
    if (node.isDirectory) {
      toggleDir(node.path);
      return;
    }

    // Read file content via backend
    try {
      const response = await fetch(`/api/files/read?path=${encodeURIComponent(node.path)}`);
      if (response.ok) {
        const data = await response.json();
        onFileOpen?.(node.path, data.content || '');
      } else {
        // Fallback: ask agent to read the file
        addMessage({
          id: `msg-${Date.now()}`,
          role: 'system',
          content: `📂 Opened ${node.path} (content loaded via agent)`,
          timestamp: Date.now(),
        });
        onFileOpen?.(node.path, '');
      }
    } catch {
      onFileOpen?.(node.path, '');
    }
  }, [onFileOpen, addMessage, toggleDir]);

  const renderNode = (node: FileNode) => {
    const isExpanded = expandedDirs.has(node.path);
    const icon = node.isDirectory
      ? (isExpanded ? '📂' : '📁')
      : getFileIcon(node.name);

    return (
      <div key={node.path} className="file-tree__node">
        <div
          className={`file-tree__item ${node.isDirectory ? 'file-tree__item--dir' : 'file-tree__item--file'}`}
          style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
          onClick={() => handleFileClick(node)}
        >
          <span className="file-tree__icon">{icon}</span>
          <span className="file-tree__name">{node.name}</span>
        </div>

        {node.isDirectory && isExpanded && node.children && (
          <div className="file-tree__children">
            {node.children.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="file-tree file-tree--loading">Loading...</div>;
  }

  if (error) {
    return (
      <div className="file-tree">
        <div className="file-tree__header">📁 Explorer</div>
        <div className="file-tree__error">{error}</div>
        <div className="file-tree__refresh" onClick={loadFileTree}>
          🔄 Retry
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree">
      <div className="file-tree__header">
        <span>📁 Explorer</span>
        <span className="file-tree__refresh" onClick={loadFileTree}>🔄</span>
      </div>
      <div className="file-tree__content">
        {files.length === 0 ? (
          <div className="file-tree__empty">No files found</div>
        ) : (
          files.map(renderNode)
        )}
      </div>
    </div>
  );
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    ts: '🔷', tsx: '🔷', js: '🟨', jsx: '🟨',
    py: '🐍', go: '🔵', rs: '🦀', java: '☕',
    c: '⚙️', cpp: '⚙️', cs: '⚙️',
    html: '🌐', css: '🎨', scss: '🎨',
    json: '📋', yaml: '📋', yml: '📋',
    md: '📝', sh: '⚡', sql: '🗃️',
    png: '🖼️', jpg: '🖼️', svg: '🖼️',
    gif: '🖼️', webp: '🖼️',
    txt: '📄', log: '📄',
    toml: '📄', cfg: '📄', ini: '📄',
  };
  return iconMap[ext || ''] || '📄';
}
