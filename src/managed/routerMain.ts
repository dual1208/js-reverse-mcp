/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

import {SERVER_INSTRUCTIONS} from '../serverInstructions.js';
import {tools} from '../tools/catalog.js';
import {TOOL_OUTPUT_SCHEMA} from '../tools/ToolDefinition.js';

import {BrowserRouter} from './router.js';

const harness = process.env.JS_REVERSE_HARNESS ?? 'mcp';
const router = new BrowserRouter(harness);
const server = new McpServer(
  {name: 'js-reverse', version: '4.0.1'},
  {
    instructions:
      'Start with select_browser. Keep its browserSession for a bounded browsing activity and pass it to every browser tool. Keep conversationId for this conversation only. Profile policy chooses Cesar for known Google/OpenRouter/X/cloud services and Tyson by default; classify unknown cloud providers using service. Login redirects retain the existing binding. Reconnect a manually disconnected instance only when the user requests it. Browser and debugger IDs belong to the selected worker.\n\n' +
      SERVER_INSTRUCTIONS,
  },
);
function failure(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

server.registerTool(
  'select_browser',
  {
    description:
      "Bind a browsing activity to Cesar or Tyson and an independent JS-Reverse worker. Creates a new working tab on first use. URL is routing input only; navigate_page opens it. Reuse returned conversationId for subsequent activities in this conversation, and browserSession for continuation across redirects. Never reuse another conversation's IDs.",
    inputSchema: {
      purpose: z
        .string()
        .min(1)
        .max(500)
        .describe('What this browsing activity is for.'),
      label: z
        .string()
        .min(1)
        .max(160)
        .describe(
          'Short task label displayed under the profile in the menu bar.',
        ),
      url: z
        .string()
        .optional()
        .describe(
          'Initial service URL used for policy selection. Does not navigate.',
        ),
      service: z
        .enum(['general', 'learning', 'cloud', 'google', 'openrouter', 'x'])
        .default('general')
        .describe(
          'Classify the activity; cloud includes any VM or cloud provider, even an unknown domain.',
        ),
      profile: z
        .enum(['auto', 'cesar', 'tyson'])
        .default('auto')
        .describe('Use auto unless the user explicitly chooses a profile.'),
      conversationId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          'Stable ID for the current conversation. If unavailable, omit once and reuse the returned ID. Pi supplies its session ID automatically.',
        ),
      browserSession: z
        .string()
        .optional()
        .describe(
          'Existing binding when continuing this activity; preserves profile through OAuth redirects.',
        ),
      reconnect: z
        .boolean()
        .default(false)
        .describe(
          'Set true only after the user explicitly requests reconnection of a disconnected instance.',
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  async params => {
    try {
      const result = await router.select(params);
      return {
        content: [{type: 'text', text: JSON.stringify(result)}],
        structuredContent: result,
      };
    } catch (error) {
      return failure(error);
    }
  },
);

for (const tool of tools) {
  const {category: _category, ...annotations} = tool.annotations;
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      outputSchema: tool.outputSchema ?? TOOL_OUTPUT_SCHEMA,
      inputSchema: {
        ...tool.schema,
        browserSession: z
          .string()
          .min(1)
          .describe(
            'Binding returned by select_browser for this conversation and activity.',
          ),
      },
      annotations,
    },
    async (params, extra) => {
      const {browserSession, ...args} = params;
      try {
        return await router.call(browserSession, tool.name, args, extra.signal);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 7_000);
  await router.close();
  await server.close();
  clearTimeout(deadline);
  process.exit(0);
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
process.stdin.on('end', () => {
  void stop();
});
await server.connect(new StdioServerTransport());
