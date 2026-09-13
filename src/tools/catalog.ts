/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as consoleTools from './console.js';
import * as debuggerTools from './debugger.js';
import * as frameTools from './frames.js';
import * as interactionTools from './interaction.js';
import * as networkTools from './network.js';
import * as pagesTools from './pages.js';
import * as screenshotTools from './screenshot.js';
import * as scriptTools from './script.js';
import * as siteDataTools from './siteData.js';
import type {ToolDefinition} from './ToolDefinition.js';
import * as websocketTools from './websocket.js';

export const tools = [
  ...Object.values(consoleTools),
  ...Object.values(debuggerTools),
  ...Object.values(frameTools),
  ...Object.values(interactionTools),
  ...Object.values(networkTools),
  ...Object.values(pagesTools),
  ...Object.values(screenshotTools),
  ...Object.values(scriptTools),
  ...Object.values(siteDataTools),
  ...Object.values(websocketTools),
]
  .filter(
    tool =>
      typeof tool === 'object' &&
      tool !== null &&
      'name' in tool &&
      'handler' in tool &&
      'schema' in tool &&
      'annotations' in tool,
  )
  .sort((a, b) => a.name.localeCompare(b.name)) as ToolDefinition[];
