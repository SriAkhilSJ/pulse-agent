// packages/backend/src/tools/index.ts
// Tool registry — exports all available tools

import {
  readFileTool, writeFileTool, listFilesTool, editFileTool, searchCodeTool, clearReadCache,
} from './file/file-tools.js';
import { runTerminalTool, detectTerminalProfile, getShellInfo } from './terminal/terminal-tools.js';
import { webSearchTool, webFetchTool } from './web-tools.js';
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitStashTool } from './git-tools.js';
import { todoTool } from './todo-tool.js';
import { logChangeTool, getChangeLogTool, revertChangesTool, clearChangeLog } from './change-tools.js';
import { visionTool } from './vision-tool.js';
import { imageGenTool } from './image-gen-tool.js';
import {
  desktopScreenshotTool,
  desktopClickTool,
  desktopTypeTool,
  desktopScrollTool,
  desktopGetScreenSizeTool,
} from './desktop-tool.js';
import { initBrowserTools } from './browser-tool.js';

export const ALL_TOOLS = [
  // File tools
  readFileTool, writeFileTool, listFilesTool, editFileTool, searchCodeTool, clearReadCache,
  // Terminal tools
  runTerminalTool, detectTerminalProfile, getShellInfo,
  // Web tools
  webSearchTool, webFetchTool,
  // Git tools
  gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitStashTool,
  // Todo tool
  todoTool,
  // Change tracking
  logChangeTool, getChangeLogTool, revertChangesTool, clearChangeLog,
  // Vision (Ollama llava:7b)
  visionTool,
  // Image Generation (ComfyUI)
  imageGenTool,
  // Desktop Automation (nut.js)
  desktopScreenshotTool, desktopClickTool, desktopTypeTool, desktopScrollTool, desktopGetScreenSizeTool,
  // Browser Automation (Puppeteer) — lazy loaded
];

// Initialize browser tools asynchronously
let browserToolsLoaded = false;
export async function ensureBrowserTools() {
  if (!browserToolsLoaded) {
    const browserTools = await initBrowserTools();
    ALL_TOOLS.push(...browserTools);
    browserToolsLoaded = true;
  }
}

export {
  readFileTool, writeFileTool, listFilesTool, editFileTool, searchCodeTool,
  runTerminalTool, detectTerminalProfile, getShellInfo,
  webSearchTool, webFetchTool,
  gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitStashTool,
  todoTool,
  logChangeTool, getChangeLogTool, revertChangesTool, clearChangeLog,
  visionTool,
  imageGenTool,
  desktopScreenshotTool, desktopClickTool, desktopTypeTool, desktopScrollTool, desktopGetScreenSizeTool,
};
