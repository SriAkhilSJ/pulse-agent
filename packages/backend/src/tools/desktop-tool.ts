// packages/backend/src/tools/desktop-tool.ts
// Desktop Automation tool — mouse, keyboard, screen capture via nut.js
// Uses @nut-tree-fork/nut-js for cross-platform desktop control

import { defineTool } from '../tool-registry.js';

// nut.js imports (dynamically loaded to avoid issues if not installed)
let nut: any = null;
try {
  nut = require('@nut-tree-fork/nut-js');
} catch {
  // nut.js not available — tools will return error messages
}

const screen = nut?.screen;
const mouse = nut?.mouse;
const keyboard = nut?.keyboard;

export const desktopScreenshotTool = defineTool('desktop_screenshot', 'Capture a screenshot of the entire screen or a specific region. Returns the file path of the saved screenshot.', {
  type: 'object',
  properties: {
    output_path: { type: 'string', description: 'File path to save the screenshot (default: /tmp/screenshot.png)' },
    region: { type: 'string', description: 'Optional region: "full", "active-window", or "center"' },
  },
  required: [],
}, async (args: Record<string, unknown>) => {
  if (!screen) {
    return 'Desktop automation not available. Install @nut-tree-fork/nut-js.';
  }

  const outputPath = String(args.output_path || '/tmp/screenshot.png');
  const region = String(args.region || 'full');

  try {
    let image;
    if (region === 'active-window') {
      image = await screen.capture();
    } else {
      image = await screen.capture();
    }

    // Save to file
    const buffer = await image.toRGB();
    const fs = require('fs');
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    return `Screenshot saved to ${outputPath}`;
  } catch (err) {
    return `Screenshot failed: ${(err as Error).message}`;
  }
});

export const desktopClickTool = defineTool('desktop_click', 'Click at specific coordinates on the screen.', {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'X coordinate' },
    y: { type: 'number', description: 'Y coordinate' },
    button: { type: 'string', description: 'Mouse button: "left", "right", "middle" (default: left)' },
    double_click: { type: 'boolean', description: 'Double click (default: false)' },
  },
  required: ['x', 'y'],
}, async (args: Record<string, unknown>) => {
  if (!mouse) {
    return 'Desktop automation not available. Install @nut-tree-fork/nut-js.';
  }

  const x = Number(args.x);
  const y = Number(args.y);
  const button = String(args.button || 'left');
  const doubleClick = args.double_click === true;

  try {
    const { Point } = require('@nut-tree-fork/nut-js');
    const point = new Point(x, y);

    if (doubleClick) {
      await mouse.doubleClick(button === 'right' ? mouse.Button.RIGHT : mouse.Button.LEFT);
    } else {
      await mouse.click(button === 'right' ? mouse.Button.RIGHT : mouse.Button.LEFT);
    }
    return `Clicked at (${x}, ${y}) with ${button} button${doubleClick ? ' (double)' : ''}`;
  } catch (err) {
    return `Click failed: ${(err as Error).message}`;
  }
});

export const desktopTypeTool = defineTool('desktop_type', 'Type text as if from the keyboard.', {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Text to type' },
    delay_ms: { type: 'number', description: 'Delay between keystrokes in ms (default: 50)' },
  },
  required: ['text'],
}, async (args: Record<string, unknown>) => {
  if (!keyboard) {
    return 'Desktop automation not available. Install @nut-tree-fork/nut-js.';
  }

  const text = String(args.text);
  const delay = Number(args.delay_ms || 50);

  try {
    await keyboard.type(text);
    return `Typed: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`;
  } catch (err) {
    return `Type failed: ${(err as Error).message}`;
  }
});

export const desktopScrollTool = defineTool('desktop_scroll', 'Scroll the mouse wheel.', {
  type: 'object',
  properties: {
    direction: { type: 'string', description: 'Scroll direction: "up" or "down"' },
    amount: { type: 'number', description: 'Number of scroll steps (default: 3)' },
  },
  required: ['direction'],
}, async (args: Record<string, unknown>) => {
  if (!mouse) {
    return 'Desktop automation not available. Install @nut-tree-fork/nut-js.';
  }

  const direction = String(args.direction);
  const amount = Number(args.amount || 3);

  try {
    for (let i = 0; i < amount; i++) {
      if (direction === 'up') {
        await mouse.scrollUp(100);
      } else {
        await mouse.scrollDown(100);
      }
    }
    return `Scrolled ${direction} ${amount} steps`;
  } catch (err) {
    return `Scroll failed: ${(err as Error).message}`;
  }
});

export const desktopGetScreenSizeTool = defineTool('desktop_get_screen_size', 'Get the screen resolution.', {
  type: 'object',
  properties: {},
  required: [],
}, async () => {
  if (!screen) {
    return 'Desktop automation not available. Install @nut-tree-fork/nut-js.';
  }

  try {
    const size = await screen.width();
    const height = await screen.height();
    return `Screen size: ${size}x${height}`;
  } catch (err) {
    return `Failed: ${(err as Error).message}`;
  }
});
