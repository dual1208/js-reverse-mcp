/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

import {
  profileRuntime,
  runtimePath,
  writePrivateJSON,
} from '../src/managed/config.js';
import type {ManagerConfig} from '../src/managed/config.js';
import {ConnectionManager} from '../src/managed/manager.js';
import {SERVER_INSTRUCTIONS} from '../src/serverInstructions.js';

test(
  'real Chrome: two profiles, three conversation workers, sticky binding and independent cleanup',
  {
    skip: process.env.JS_REVERSE_INTEGRATION !== '1',
    timeout: 120_000,
  },
  async () => {
    const folder = mkdtempSync(
      path.join(os.tmpdir(), 'js-reverse-managed-test-'),
    );
    const config: ManagerConfig = {
      version: 1,
      stateDir: folder,
      workerEntry: path.resolve(import.meta.dirname, '../src/index.js'),
      allowedRoots: [folder],
      profiles: {
        cesar: path.join(folder, 'cesar'),
        tyson: path.join(folder, 'tyson'),
      },
      profileExtensions: {
        cesar: [path.join(folder, 'fixture-extension')],
        tyson: [],
      },
    };
    const extensionPath = config.profileExtensions!.cesar[0];
    mkdirSync(extensionPath);
    writeFileSync(
      path.join(extensionPath, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Managed fixture',
        version: '1.0',
      }),
    );
    const configFile = path.join(folder, 'config.json');
    writePrivateJSON(configFile, config);
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (pair): pair is [string, string] => pair[1] !== undefined,
      ),
    );
    const env = {
      ...environment,
      JS_REVERSE_MANAGER_CONFIG: configFile,
      JS_REVERSE_TEST_HEADLESS: '1',
    };
    const hosts = Object.entries(config.profiles).map(([name, root]) => {
      mkdirSync(path.join(root, 'Default'), {recursive: true});
      writeFileSync(path.join(root, 'Default/Preferences'), '{}');
      return spawn(
        process.execPath,
        [
          path.resolve(import.meta.dirname, '../src/managed/profileHost.js'),
          name,
        ],
        {env, stdio: 'ignore'},
      );
    });
    const manager = new ConnectionManager(config);
    const clients: Client[] = [];
    async function tool(
      client: Client,
      name: string,
      args: Record<string, unknown>,
    ): Promise<CallToolResult> {
      return (await client.callTool({name, arguments: args}, undefined, {
        timeout: 60_000,
      })) as CallToolResult;
    }
    try {
      const deadline = Date.now() + 40_000;
      while (
        !profileRuntime(config, 'cesar') ||
        !profileRuntime(config, 'tyson')
      ) {
        assert.ok(
          Date.now() < deadline,
          'Both temporary profile hosts should become ready',
        );
        assert.ok(
          hosts.every(host => host.exitCode === null),
          'A profile host exited',
        );
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await manager.listen();
      writePrivateJSON(runtimePath(config), {
        url: manager.url,
        token: manager.token,
        pid: process.pid,
      });
      for (const harness of ['codex', 'pi']) {
        const client = new Client({name: `test-${harness}`, version: '1'});
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [
              path.resolve(import.meta.dirname, '../src/managed/routerMain.js'),
            ],
            env: {...env, JS_REVERSE_HARNESS: harness},
            stderr: 'ignore',
          }),
        );
        clients.push(client);
        assert.ok(
          client.getInstructions()?.includes(SERVER_INSTRUCTIONS),
          'The facade preserves original reverse-engineering instructions',
        );
      }
      const selections = [
        {
          conversationId: 'codex-a',
          purpose: 'cloud administration',
          url: 'https://console.cloud.google.com',
          label: 'Cloud A',
        },
        {
          conversationId: 'codex-b',
          purpose: 'OpenRouter',
          url: 'https://openrouter.ai',
          label: 'Cloud B',
        },
        {
          conversationId: 'pi-c',
          purpose: 'IELTS practice',
          service: 'learning',
          label: 'IELTS',
        },
      ];
      const bindings: Array<{browserSession: string; profile: string}> = [];
      for (const [i, selection] of selections.entries()) {
        const result = await tool(
          clients[i === 2 ? 1 : 0],
          'select_browser',
          selection,
        );
        assert.ok(!result.isError, JSON.stringify(result));
        bindings.push(
          result.structuredContent as {browserSession: string; profile: string},
        );
      }
      assert.deepEqual(
        bindings.map(binding => binding.profile),
        ['cesar', 'cesar', 'tyson'],
      );
      const listing = await tool(clients[0], 'select_page', {
        browserSession: bindings[1].browserSession,
      });
      const before = listing.structuredContent?.data as {
        pages: Array<{pageIdx: number; selected: boolean}>;
      };
      const selectedBefore = before.pages.find(page => page.selected)?.pageIdx;
      const opened = await tool(clients[0], 'new_page', {
        browserSession: bindings[1].browserSession,
        url: 'about:blank',
      });
      assert.ok(!opened.isError, JSON.stringify(opened));
      const afterListing = await tool(clients[0], 'select_page', {
        browserSession: bindings[1].browserSession,
      });
      const after = afterListing.structuredContent?.data as {
        pages: Array<{pageIdx: number; selected: boolean}>;
      };
      assert.equal(
        after.pages.find(page => page.selected)?.pageIdx,
        selectedBefore,
        "new_page must reuse only this worker's own selected blank",
      );
      const evaluate = (i: number, fn: string) =>
        tool(clients[i === 2 ? 1 : 0], 'evaluate_script', {
          browserSession: bindings[i].browserSession,
          function: fn,
          confirm: true,
        });
      for (let i = 0; i < 3; i++) {
        const result = await evaluate(
          i,
          `() => { document.title = 'Managed fixture ${i}'; return document.title; }`,
        );
        assert.ok(!result.isError, JSON.stringify(result));
      }
      const isolated = await evaluate(0, '() => document.title');
      assert.match(JSON.stringify(isolated), /Managed fixture 0/);
      const sticky = await tool(clients[1], 'select_browser', {
        browserSession: bindings[2].browserSession,
        purpose: 'OAuth callback for IELTS',
        label: 'IELTS login',
        url: 'https://accounts.google.com',
      });
      assert.equal(sticky.structuredContent?.profile, 'tyson');
      const tree = manager.state();
      assert.deepEqual(
        tree.profiles.map(profile => profile.instances.length),
        [2, 1],
      );
      assert.ok(
        tree.profiles.every(profile =>
          profile.instances.every(instance => instance.sessions.length > 0),
        ),
      );
      const first = tree.profiles[0].instances[0];
      const session = first.sessions.at(-1)!;
      const detached = await fetch(
        `${manager.url}/instances/${first.id}/sessions/${session.id}/detach`,
        {
          method: 'POST',
          headers: {Authorization: `Bearer ${manager.token}`},
        },
      );
      assert.equal(detached.status, 200, await detached.text());
      manager.disconnect(first.id);
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.ok((await evaluate(0, '() => 1')).isError);
      assert.ok(!(await evaluate(1, '() => document.title')).isError);
      assert.ok(!(await evaluate(2, '() => document.title')).isError);
      const refused = await tool(clients[0], 'select_browser', selections[0]);
      assert.ok(
        refused.isError,
        'Manual disconnect must not silently reconnect',
      );
      const reconnected = await tool(clients[0], 'select_browser', {
        ...selections[0],
        reconnect: true,
      });
      assert.ok(!reconnected.isError, JSON.stringify(reconnected));
      assert.notEqual(
        reconnected.structuredContent?.browserSession,
        bindings[0].browserSession,
      );
      await Promise.all(clients.map(client => client.close()));
      assert.ok(
        profileRuntime(config, 'cesar') && profileRuntime(config, 'tyson'),
        'Chrome outlives the MCP clients',
      );
    } finally {
      await Promise.allSettled(clients.map(client => client.close()));
      await manager.close();
      await Promise.all(
        hosts.map(async host => {
          if (host.exitCode !== null) return;
          const exited = once(host, 'exit');
          host.kill('SIGTERM');
          const timeout = setTimeout(() => host.kill('SIGKILL'), 5_000);
          await exited;
          clearTimeout(timeout);
        }),
      );
      rmSync(folder, {recursive: true, force: true});
    }
  },
);
