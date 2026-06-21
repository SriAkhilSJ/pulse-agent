// packages/frontend/src/components/FileTree/FileTree.tsx
// File Tree Explorer — recursive folder list with file opening

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
  onFileOpen?: (filePath: string) => void;
}

export function FileTree({ workspacePath = '/workspace', onFileOpen }: FileTreeProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const { addMessage } = useAgentStore();

  // Load file tree
  useEffect(() => {
    loadFileTree(workspacePath);
  }, [workspacePath]);

  const loadFileTree = useCallback(async (path: string) => {
    setLoading(true);
    try {
      // In Electron, use IPC to read directory
      // In browser mode, use the backend API
      const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      } else {
        // Fallback: show mock tree
        setFiles(getMockFileTree());
      }
    } catch {
      // Fallback for development
      setFiles(getMockFileTree());
    }
    setLoading(false);
  }, []);

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

  const handleFileClick = useCallback((node: FileNode) => {
    if (node.isDirectory) {
      toggleDir(node.path);
    } else {
      onFileOpen?.(node.path);
      addMessage({
        id: `msg-${Date.now()}`,
        role: 'system',
        content: `📂 Opened ${node.path}`,
        timestamp: Date.now(),
      });
    }
  }, [onFileOpen, addMessage]);

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

  return (
    <div className="file-tree">
      <div className="file-tree__header">
        <span>📁 Explorer</span>
      </div>
      <div className="file-tree__content">
        {files.map(renderNode)}
      </div>
    </div>
  );
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    ts: '🔷', tsx: '🔷',
    js: '🟨', jsx: '🟨',
    py: '🐍',
    go: '🔵',
    rs: '🦀',
    java: '☕',
    c: '⚙️', cpp: '⚙️', cs: '⚙️',
    html: '🌐', css: '🎨', scss: '🎨',
    json: '📋', yaml: '📋', yml: '📋',
    md: '📝', sh: '⚡', sql: '🗃️',
    png: '🖼️', jpg: '🖼️', svg: '🖼️',
  };
  return iconMap[ext || ''] || '📄';
}

// Mock file tree for development
function getMockFileTree(): FileNode[] {
  return [
    {
      name: 'src',
      path: '/workspace/src',
      isDirectory: true,
      depth: 0,
      children: [
        {
          name: 'index.ts',
          path: '/workspace/src/index.ts',
          isDirectory: false,
          depth: 1,
        },
        {
          name: 'auth.ts',
          path: '/workspace/src/auth.ts',
          isDirectory: false,
          depth: 1,
        },
        {
          name: 'utils',
          path: '/workspace/src/utils',
          isDirectory: true,
          depth: 1,
          children: [
            {
              name: 'helpers.ts',
              path: '/workspace/src/utils/helpers.ts',
              isDirectory: false,
              depth: 2,
            },
          ],
        },
      ],
    },
    {
      name: 'package.json',
      path: '/workspace/package.json',
      isDirectory: false,
      depth: 0,
    },
    {
      name: 'README.md',
      path: '/workspace/README.md',
      isDirectory: false,
      depth: 0,
    },
  ];
}
