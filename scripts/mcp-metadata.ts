/**
 * @license
 * Copyright 2026
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';

export interface McpMetadata {
  tools: Tool[];
  instructions: string;
}

/** Query the actual MCP contract without a browser or a contributor's identity. */
export async function loadMcpMetadata(): Promise<McpMetadata> {
  const serverPath = path.resolve('build/src/index.js');
  try {
    await fs.access(serverPath);
  } catch {
    throw new Error('Run npm run build before querying MCP metadata.');
  }
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'js-reverse-metadata-'));
  const client = new Client(
    {name: 'mcp-metadata-reader', version: '1.0.0'},
    {capabilities: {}},
  );
  try {
    // Listing schemas never launches Chrome. The private marker satisfies the
    // existing legacy startup policy, without changing the caller's filesystem.
    const profile = path.join(
      home,
      '.local/share/js-reverse-mcp/active-profile',
    );
    await fs.mkdir(path.join(profile, 'Default'), {recursive: true});
    await fs.writeFile(path.join(profile, 'Default/Preferences'), '{}');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {...getDefaultEnvironment(), HOME: home, USERPROFILE: home},
      stderr: 'pipe',
    });
    // Keep inherited credentials out of the child and local paths out of output.
    transport.stderr?.on('data', () => undefined);
    await client.connect(transport);
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools(cursor ? {cursor} : undefined);
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    return {tools, instructions: client.getInstructions()?.trim() ?? ''};
  } finally {
    await client.close().catch(() => undefined);
    await fs.rm(home, {recursive: true, force: true});
  }
}
