/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {randomUUID} from 'node:crypto';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

import {Mutex} from '../Mutex.js';

import {configPath, control, readConfig} from './config.js';
import type {ProfileName} from './config.js';
import {chooseProfile} from './policy.js';
import type {RouteRequest} from './policy.js';

interface Registration {
  id: string;
  token: string;
  browserUrl: string;
}
interface Binding {
  browserSession: string;
  conversationId: string;
  profile: ProfileName;
  reason: string;
  client: Client;
  disconnected: boolean;
}
export interface Selection extends RouteRequest {
  conversationId?: string;
  browserSession?: string;
  label: string;
  reconnect?: boolean;
}

export class BrowserRouter {
  readonly #bindings = new Map<string, Binding>();
  readonly #byConversationProfile = new Map<string, Binding>();
  readonly #mutex = new Mutex();
  constructor(readonly harness: string) {}

  async select(request: Selection): Promise<Record<string, unknown>> {
    const guard = await this.#mutex.acquire({timeoutMs: 60_000});
    try {
      const existing = request.browserSession
        ? this.binding(request.browserSession)
        : undefined;
      if (
        existing &&
        request.profile &&
        request.profile !== 'auto' &&
        request.profile !== existing.profile
      ) {
        throw new Error(
          'This activity is already bound. Start a separate activity without browserSession to choose another profile.',
        );
      }
      if (existing && !request.reconnect) {
        if (existing.disconnected)
          throw new Error(
            'Instance disconnected. Reconnect only on explicit user request.',
          );
        return this.describe(
          existing,
          'Existing activity binding retained, including across login redirects',
        );
      }
      const conversationId =
        existing?.conversationId ?? request.conversationId ?? randomUUID();
      const decision = existing
        ? {profile: existing.profile, reason: existing.reason}
        : chooseProfile(request);
      const key = `${conversationId}:${decision.profile}`;
      const previous = this.#byConversationProfile.get(key);
      if (previous && !previous.disconnected)
        return this.describe(previous, decision.reason);
      if (previous?.disconnected && !request.reconnect)
        throw new Error(
          'This conversation instance was disconnected. Use reconnect only on explicit user request.',
        );

      const registration = await control<Registration>('/instances', {
        profile: decision.profile,
        conversation: conversationId,
        harness: this.harness,
        label: request.label,
      });
      const config = readConfig();
      const client = new Client({
        name: 'js-reverse-managed-worker',
        version: '1.0.0',
      });
      const binding: Binding = {
        browserSession: registration.id,
        conversationId,
        ...decision,
        client,
        disconnected: false,
      };
      client.onclose = () => {
        binding.disconnected = true;
      };
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] => pair[1] !== undefined,
        ),
      );
      delete env.JS_REVERSE_PROFILE_HOST;
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          config.workerEntry,
          '--browserUrl',
          registration.browserUrl,
          ...config.allowedRoots.flatMap(root => ['--allowedRoots', root]),
        ],
        env: {
          ...env,
          JS_REVERSE_MANAGER_CONFIG: configPath(),
          JS_REVERSE_CONNECTION_TOKEN: registration.token,
          JS_REVERSE_BROWSER_URL: registration.browserUrl,
        },
        stderr: 'ignore',
      });
      try {
        await client.connect(transport);
        // Establish CDP and this worker's new working tab before returning a binding.
        const first = (await client.callTool(
          {name: 'select_page', arguments: {}},
          undefined,
          {timeout: 60_000},
        )) as CallToolResult;
        if (first.isError)
          throw new Error(
            first.content
              .filter(item => item.type === 'text')
              .map(item => item.text)
              .join('\n'),
          );
      } catch (error) {
        await client.close().catch(() => undefined);
        await control(`/instances/${registration.id}/disconnect`, {}).catch(
          () => undefined,
        );
        throw error;
      }
      this.#bindings.set(binding.browserSession, binding);
      this.#byConversationProfile.set(key, binding);
      return this.describe(binding);
    } finally {
      guard.dispose();
    }
  }

  private binding(id: string): Binding {
    const binding = this.#bindings.get(id);
    if (!binding)
      throw new Error(
        'Unknown browserSession in this MCP connection. Call select_browser to create an activity binding.',
      );
    return binding;
  }

  private describe(
    binding: Binding,
    reason = binding.reason,
  ): Record<string, unknown> {
    return {
      browserSession: binding.browserSession,
      conversationId: binding.conversationId,
      profile: binding.profile,
      reason,
      instruction:
        'Pass browserSession to every browser tool. Reuse conversationId for another activity in this conversation. The working tab is selected; use navigate_page to open the activity URL. Existing page reuse requires an explicit select_page.',
    };
  }

  async call(
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const binding = this.binding(id);
    if (binding.disconnected)
      throw new Error(
        'Instance disconnected; browser remains running. Explicit reconnect is required.',
      );
    return (await binding.client.callTool({name, arguments: args}, undefined, {
      signal,
      timeout: 120_000,
    })) as CallToolResult;
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.#bindings.values()].map(async binding => {
        binding.disconnected = true;
        await binding.client.close();
        await control(
          `/instances/${binding.browserSession}/disconnect`,
          {},
        ).catch(() => undefined);
      }),
    );
  }
}
