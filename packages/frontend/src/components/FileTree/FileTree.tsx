// packages/frontend/src/components/FileTree/FileTree.tsx
// FileTree — real file system explorer via Electron IPC

import React, { useCallback, useEffect, useState } from 'react';
import { useFileStore, type FileNode } from '../../store/file-store.js';

interface FileTreeProps {
  onFileOpen?: (filePath: string, content: string) => void;
}

export function FileTree({ onFileOpen }: FileTreeProps) {
  const {
    workspaceRoot, fileTree, expandedPaths, activeFile, isLoading, error,
    loadTree, toggleFolder, openFile, refreshTree, setError,
  } = useFileStore();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);

  // Handle open folder
  const handleOpenFolder = useCallback(async () => {
    try {
      const folderPath = await window.electronAPI.openFolder();
      if (folderPath) {
        await loadTree(folderPath);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [loadTree, setError]);

  // Handle file click
  const handleFileClick = useCallback(async (node: FileNode) => {
    if (node.type === 'folder') {
      toggleFolder(node.path);
    } else {
      try {
        await openFile(node.path);
        const content = await window.electronAPI.readFile(node.path);
        onFileOpen?.(node.path, content);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }, [toggleFolder, openFile, onFileOpen, setError]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Handle context menu actions
  const handleDelete = useCallback(async (node: FileNode) => {
    setContextMenu(null);
    if (confirm(`Delete ${node.name}?`)) {
      try {
        await window.electronAPI.deleteFile(node.path);
        await refreshTree();
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }, [refreshTree, setError]);

  const handleNewFile = useCallback(async (parentPath: string) => {
    setContextMenu(null);
    const name = prompt('New file name:');
    if (name) {
      try {
        const filePath = `${parentPath}/${name}`;
        await window.electronAPI.createFile(filePath);
        await refreshTree();
        await openFile(filePath);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }, [refreshTree, openFile, setError]);

  const handleNewFolder = useCallback(async (parentPath: string) => {
    setContextMenu(null);
    const name = prompt('New folder name:');
    if (name) {
      try {
        const folderPath = `${parentPath}/${name}`;
        await window.electronAPI.createFolder(folderPath);
        await refreshTree();
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }, [refreshTree, setError]);

  // Render a single node
  const renderNode = useCallback((node: FileNode) => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = activeFile === node.path;
    const icon = node.type === 'folder'
      ? (isExpanded ? '📂' : '📁')
      : getFileIcon(node.name);

    return (
      <div key={node.path} className="file-tree__node">
        <div
          className={`file-tree__item ${isActive ? 'file-tree__item--active' : ''} file-tree__item--${node.type}`}
          style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
          onClick={() => handleFileClick(node)}
          onContextMenu={(e) => handleContextMenu(e, node)}
        >
          <span className="file-tree__icon">{icon}</span>
          <span className="file-tree__name">{node.name}</span>
          {node.type === 'file' && node.size !== undefined && node.size > 0 && (
            <span className="file-tree__size">{formatSize(node.size)}</span>
          )}
        </div>

        {node.type === 'folder' && isExpanded && node.children && (
          <div className="file-tree__children">
            {node.children.length === 0 ? (
              <div className="file-tree__empty-child">Empty folder</div>
            ) : (
              node.children.map(renderNode)
            )}
          </div>
        )}
      </div>
    );
  }, [expandedPaths, activeFile, handleFileClick, handleContextMenu]);

  // No workspace loaded
  if (!workspaceRoot && !isLoading) {
    return (
      <div className="file-tree">
        <div className="file-tree__header">📁 Explorer</div>
        <div className="file-tree__empty">
          <p>No folder open</p>
          <button className="file-tree__open-btn" onClick={handleOpenFolder}>
            📂 Open Folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree">
      <div className="file-tree__header">
        <span>📁 {workspaceRoot?.split('/').pop() || 'Explorer'}</span>
        <div className="file-tree__actions">
          <span className="file-tree__refresh" onClick={() => refreshTree()} title="Refresh">🔄</span>
          <span className="file-tree__new-file" onClick={() => workspaceRoot && handleNewFile(workspaceRoot)} title="New File">📄</span>
          <span className="file-tree__new-folder" onClick={() => workspaceRoot && handleNewFolder(workspaceRoot)} title="New Folder">📁</span>
          <span className="file-tree__open" onClick={handleOpenFolder} title="Open Folder">📂</span>
        </div>
      </div>

      {isLoading && <div className="file-tree__loading">Loading...</div>}
      {error && <div className="file-tree__error">{error}</div>}

      <div className="file-tree__content">
        {fileTree.map(renderNode)}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="file-tree__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.node.type === 'folder' && (
            <>
              <div className="file-tree__context-item" onClick={() => handleNewFile(contextMenu.node.path)}>📄 New File</div>
              <div className="file-tree__context-item" onClick={() => handleNewFolder(contextMenu.node.path)}>📁 New Folder</div>
              <div className="file-tree__context-separator" />
            </>
          )}
          <div className="file-tree__context-item file-tree__context-item--danger" onClick={() => handleDelete(contextMenu.node)}>🗑️ Delete</div>
        </div>
      )}
    </div>
  );
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    ts: '🔷', tsx: '🔷', js: '🟨', jsx: '🟨',
    py: '🐍', go: '🔵', rs: '🦀', java: '☕',
    c: '⚙️', cpp: '⚙️', cs: '⚙️',
    html: '🌐', css: '🎨', scss: '🎨', sass: '🎨',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '📝', txt: '📄', log: '📄',
    sh: '⚡', bash: '⚡', zsh: '⚡',
    sql: '🗃️', graphql: '◈',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', svg: '🖼️', gif: '🖼️', webp: '🖼️',
    mp4: '🎬', mp3: '🎵', wav: '🎵',
    zip: '📦', tar: '📦', gz: '📦', rar: '📦',
    pdf: '📕', doc: '📘', docx: '📘',
    env: '🔒', gitignore: '🔒', dockerignore: '🔒',
    lock: '🔒', key: '🔑', pem: '🔑',
  };
  return iconMap[ext || ''] || '📄';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
