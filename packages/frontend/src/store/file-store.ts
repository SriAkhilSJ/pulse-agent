// packages/frontend/src/store/file-store.ts
// Zustand store — file system state management

import { create } from 'zustand';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  size?: number;
  modified?: number;
  depth: number;
}

interface FileState {
  workspaceRoot: string | null;
  fileTree: FileNode[];
  expandedPaths: Set<string>;
  activeFile: string | null;
  activeFileContent: string;
  isLoading: boolean;
  error: string | null;

  // Actions
  setWorkspaceRoot: (path: string) => void;
  loadTree: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  openFile: (path: string) => Promise<void>;
  saveFile: (path: string, content: string) => Promise<boolean>;
  createFile: (path: string) => Promise<boolean>;
  createFolder: (path: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<boolean>;
  rename: (oldPath: string, newPath: string) => Promise<boolean>;
  setActiveFileContent: (content: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

// Window.electronAPI type is declared in vite-env.d.ts

export const useFileStore = create<FileState>((set, get) => ({
  workspaceRoot: null,
  fileTree: [],
  expandedPaths: new Set(),
  activeFile: null,
  activeFileContent: '',
  isLoading: false,
  error: null,

  setWorkspaceRoot: (path) => set({ workspaceRoot: path }),

  loadTree: async (path) => {
    set({ isLoading: true, error: null });
    try {
      const tree = await window.electronAPI.readDirectory(path, 0);
      set({ fileTree: tree, workspaceRoot: path, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  refreshTree: async () => {
    const { workspaceRoot } = get();
    if (workspaceRoot) {
      await get().loadTree(workspaceRoot);
    }
  },

  toggleFolder: (path) => {
    set((state) => {
      const newSet = new Set(state.expandedPaths);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
        // Lazy load children if not loaded
        const findNode = (nodes: FileNode[]): FileNode | null => {
          for (const node of nodes) {
            if (node.path === path) return node;
            if (node.children) {
              const found = findNode(node.children);
              if (found) return found;
            }
          }
          return null;
        };
        const node = findNode(state.fileTree);
        if (node && !node.children) {
          // Load children
          window.electronAPI.readDirectory(path, node.depth + 1).then((children) => {
            set((s) => ({
              fileTree: updateNodeChildren(s.fileTree, path, children),
            }));
          });
        }
      }
      return { expandedPaths: newSet };
    });
  },

  expandFolder: (path) => {
    set((state) => {
      const newSet = new Set(state.expandedPaths);
      newSet.add(path);
      return { expandedPaths: newSet };
    });
  },

  collapseFolder: (path) => {
    set((state) => {
      const newSet = new Set(state.expandedPaths);
      newSet.delete(path);
      return { expandedPaths: newSet };
    });
  },

  openFile: async (filePath) => {
    set({ isLoading: true, error: null });
    try {
      const content = await window.electronAPI.readFile(filePath);
      set({ activeFile: filePath, activeFileContent: content, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  saveFile: async (filePath, content) => {
    try {
      const result = await window.electronAPI.writeFile(filePath, content);
      if (!result.success) {
        set({ error: result.error || 'Failed to save file' });
        return false;
      }
      return true;
    } catch (err) {
      set({ error: (err as Error).message });
      return false;
    }
  },

  createFile: async (filePath) => {
    try {
      const result = await window.electronAPI.createFile(filePath);
      if (!result.success) {
        set({ error: result.error || 'Failed to create file' });
        return false;
      }
      await get().refreshTree();
      return true;
    } catch (err) {
      set({ error: (err as Error).message });
      return false;
    }
  },

  createFolder: async (folderPath) => {
    try {
      const result = await window.electronAPI.createFolder(folderPath);
      if (!result.success) {
        set({ error: result.error || 'Failed to create folder' });
        return false;
      }
      await get().refreshTree();
      return true;
    } catch (err) {
      set({ error: (err as Error).message });
      return false;
    }
  },

  deleteFile: async (filePath) => {
    try {
      const result = await window.electronAPI.deleteFile(filePath);
      if (!result.success) {
        set({ error: result.error || 'Failed to delete' });
        return false;
      }
      const { activeFile } = get();
      if (activeFile === filePath) {
        set({ activeFile: null, activeFileContent: '' });
      }
      await get().refreshTree();
      return true;
    } catch (err) {
      set({ error: (err as Error).message });
      return false;
    }
  },

  rename: async (oldPath, newPath) => {
    try {
      const result = await window.electronAPI.rename(oldPath, newPath);
      if (!result.success) {
        set({ error: result.error || 'Failed to rename' });
        return false;
      }
      await get().refreshTree();
      return true;
    } catch (err) {
      set({ error: (err as Error).message });
      return false;
    }
  },

  setActiveFileContent: (content) => set({ activeFileContent: content }),

  setError: (error) => set({ error }),

  reset: () => set({
    workspaceRoot: null,
    fileTree: [],
    expandedPaths: new Set(),
    activeFile: null,
    activeFileContent: '',
    isLoading: false,
    error: null,
  }),
}));

// Helper to update children of a specific node
function updateNodeChildren(nodes: FileNode[], targetPath: string, children: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: updateNodeChildren(node.children, targetPath, children) };
    }
    return node;
  });
}
