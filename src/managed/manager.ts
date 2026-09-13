/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import http from 'node:http';

import WebSocket, {WebSocketServer} from 'ws';
import {z} from 'zod';

import type {ManagerConfig, ProfileName, ProfileRuntime} from './config.js';
import {profileNames, profileRuntime} from './config.js';
import {SessionTracker} from './SessionTracker.js';

interface Instance {
  id: string;
  token: string;
  profile: ProfileName;
  harness: string;
  conversation: string;
  label: string;
  status: 'waiting' | 'connected' | 'disconnected';
  reason?: string;
  createdAt: string;
  connections: Map<string, Bridge>;
}
const registration = z.object({
  profile: z.enum(profileNames),
  harness: z.string().min(1).max(60),
  conversation: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});

function authorized(actual: string | undefined, token: string): boolean {
  const expected = `Bearer ${token}`;
  return (
    !!actual &&
    Buffer.byteLength(actual) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

class Bridge {
  readonly id = randomUUID();
  readonly tracker = new SessionTracker(this.id);
  #nextId = -1;
  readonly #pending = new Map<
    number,
    {resolve: () => void; reject: (error: Error) => void}
  >();
  constructor(
    readonly downstream: WebSocket,
    readonly upstream: WebSocket,
    onClose: () => void,
  ) {
    downstream.on('message', (data, binary) => {
      const raw = data.toString();
      this.tracker.observe(raw, 'request');
      if (upstream.readyState === WebSocket.OPEN) {
        if (upstream.bufferedAmount > 4 * 1024 * 1024) downstream.pause();
        upstream.send(data, {binary}, () => {
          if (downstream.isPaused) downstream.resume();
        });
      }
    });
    upstream.on('message', (data, binary) => {
      const raw = data.toString();
      this.tracker.observe(raw, 'response');
      // Reserved negative request IDs are private to manager operations. Patchright
      // uses monotonically increasing positive IDs on each transport.
      if (this.#nextId < -1 && raw.length < 65_536) {
        try {
          const message = JSON.parse(raw) as {
            id?: number;
            error?: {message: string};
          };
          const pending =
            message.id === undefined
              ? undefined
              : this.#pending.get(message.id);
          if (
            message.id !== undefined &&
            message.id < 0 &&
            message.id > this.#nextId
          ) {
            this.#pending.delete(message.id);
            if (message.error)
              pending?.reject(new Error(message.error.message));
            else pending?.resolve();
            // Consume late replies too, even after the operation timed out.
            return;
          }
        } catch {
          /* Forward non-JSON messages unchanged. */
        }
      }
      if (downstream.readyState === WebSocket.OPEN) {
        if (downstream.bufferedAmount > 4 * 1024 * 1024) upstream.pause();
        downstream.send(data, {binary}, () => {
          if (upstream.isPaused) upstream.resume();
        });
      }
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      for (const pending of this.#pending.values())
        pending.reject(new Error('CDP connection closed'));
      this.#pending.clear();
      this.close();
      onClose();
    };
    for (const socket of [upstream, downstream]) {
      socket.on('close', close);
      socket.on('error', close);
    }
  }

  close(): void {
    this.upstream.terminate();
    this.downstream.terminate();
  }

  async detach(sessionId: string): Promise<void> {
    const session = this.tracker.sessions.get(sessionId);
    if (!session) throw new Error('Session already detached');
    const id = this.#nextId--;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('Detach timed out; refresh the tree before retrying'));
      }, 5_000);
      this.#pending.set(id, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.upstream.send(
        JSON.stringify({
          id,
          method: 'Target.detachFromTarget',
          params: {sessionId},
          ...(session.parentSessionId
            ? {sessionId: session.parentSessionId}
            : {}),
        }),
      );
    });
    this.tracker.remove(sessionId);
  }
}

export class ConnectionManager {
  readonly token = randomUUID() + randomUUID();
  readonly instances = new Map<string, Instance>();
  readonly server = http.createServer((req, res) => {
    void this.handle(req, res);
  });
  readonly #websockets = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024 * 1024,
    perMessageDeflate: false,
  });
  url = '';

  constructor(
    readonly config: ManagerConfig,
    readonly getProfile: (
      name: ProfileName,
    ) => ProfileRuntime | undefined = name => profileRuntime(config, name),
  ) {
    this.server.requestTimeout = 10_000;
    this.server.headersTimeout = 10_000;
    this.server.on('upgrade', (req, socket, head) => {
      socket.on('error', () => socket.destroy());
      void (async () => {
        const segments = (req.url ?? '').split('/');
        const instance = this.instances.get(segments[2]);
        if (
          req.headers.origin ||
          segments[1] !== 'instances' ||
          segments[3] !== 'cdp' ||
          !instance ||
          instance.status === 'disconnected' ||
          !authorized(req.headers.authorization, instance.token)
        ) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }
        const profile = this.getProfile(instance.profile);
        if (!profile) {
          socket.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\n\r\n');
          return;
        }
        const upstream = new WebSocket(profile.endpoint, {
          handshakeTimeout: 5_000,
          perMessageDeflate: false,
          maxPayload: 256 * 1024 * 1024,
        });
        try {
          await once(upstream, 'open');
        } catch {
          upstream.terminate();
          socket.destroy();
          return;
        }
        if (
          socket.destroyed ||
          this.instances.get(instance.id)?.status === 'disconnected'
        ) {
          upstream.terminate();
          socket.destroy();
          return;
        }
        this.#websockets.handleUpgrade(req, socket, head, downstream => {
          const bridge = new Bridge(downstream, upstream, () => {
            instance.connections.delete(bridge.id);
            if (!instance.connections.size) {
              instance.status = 'disconnected';
              instance.reason ??=
                'CDP connection ended; explicit reconnect required';
            }
          });
          instance.connections.set(bridge.id, bridge);
          instance.status = 'connected';
        });
      })().catch(() => socket.destroy());
    });
  }

  async listen(): Promise<string> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('No manager TCP address');
    this.url = `http://127.0.0.1:${address.port}`;
    return this.url;
  }

  state() {
    return {
      version: 1,
      profiles: profileNames.map(name => ({
        id: name,
        userDataDir: this.config.profiles[name],
        running: !!this.getProfile(name),
        instances: [...this.instances.values()]
          .filter(instance => instance.profile === name)
          .map(instance => ({
            id: instance.id,
            harness: instance.harness,
            conversation: instance.conversation,
            label: instance.label,
            status: instance.status,
            reason: instance.reason,
            createdAt: instance.createdAt,
            connectionCount: instance.connections.size,
            sessions: [...instance.connections.values()].flatMap(bridge => [
              ...bridge.tracker.sessions.values(),
            ]),
          })),
      })),
    };
  }

  disconnect(id: string, reason = 'Disconnected from menu'): void {
    const instance = this.instances.get(id);
    if (!instance) throw new Error('Unknown JS-Reverse instance');
    instance.status = 'disconnected';
    instance.reason = reason;
    for (const bridge of instance.connections.values()) bridge.close();
    instance.connections.clear();
  }

  async close(): Promise<void> {
    for (const instance of this.instances.values())
      this.disconnect(instance.id, 'Manager stopped');
    this.#websockets.close();
    this.server.closeAllConnections();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.headers.origin) {
        reply(403, {error: 'Browser-origin requests are not accepted'});
        return;
      }
      const route = new URL(req.url ?? '/', this.url);
      const segments = route.pathname.split('/').map(decodeURIComponent);
      const instance = this.instances.get(segments[2]);
      if (
        segments[1] === 'instances' &&
        segments[3] === 'json' &&
        segments[4] === 'version'
      ) {
        if (
          !instance ||
          instance.status === 'disconnected' ||
          !authorized(req.headers.authorization, instance.token)
        ) {
          reply(403, {
            error: 'Instance disconnected; explicit reconnect required',
          });
          return;
        }
        if (!this.getProfile(instance.profile)) {
          reply(503, {error: `${instance.profile} browser is not running`});
          return;
        }
        reply(200, {
          Browser: 'JS-Reverse managed Chrome',
          webSocketDebuggerUrl: `${this.url.replace('http:', 'ws:')}/instances/${instance.id}/cdp`,
        });
        return;
      }
      if (!authorized(req.headers.authorization, this.token)) {
        reply(403, {error: 'Manager authentication required'});
        return;
      }
      if (req.method === 'GET' && route.pathname === '/state') {
        reply(200, this.state());
        return;
      }
      if (req.method === 'POST' && route.pathname === '/instances') {
        let body = '';
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 16_384) {
            reply(413, {error: 'Registration too large'});
            return;
          }
        }
        const data = registration.parse(JSON.parse(body));
        if (!this.getProfile(data.profile)) {
          reply(503, {error: `${data.profile} browser is not ready`});
          return;
        }
        const created: Instance = {
          ...data,
          id: randomUUID(),
          token: randomUUID() + randomUUID(),
          status: 'waiting',
          createdAt: new Date().toISOString(),
          connections: new Map(),
        };
        this.instances.set(created.id, created);
        reply(201, {
          id: created.id,
          token: created.token,
          browserUrl: `${this.url}/instances/${created.id}/`,
        });
        return;
      }
      if (instance && req.method === 'POST' && segments[3] === 'disconnect') {
        this.disconnect(instance.id);
        reply(200, {ok: true});
        return;
      }
      if (instance && req.method === 'DELETE' && segments.length === 3) {
        if (instance.status !== 'disconnected') {
          reply(409, {error: 'Disconnect the instance first'});
          return;
        }
        this.instances.delete(instance.id);
        reply(200, {ok: true});
        return;
      }
      if (
        instance &&
        req.method === 'POST' &&
        segments[3] === 'sessions' &&
        segments[5] === 'detach'
      ) {
        const [connectionId, sessionId] = segments[4].split(':');
        const bridge = instance.connections.get(connectionId);
        if (!bridge || !sessionId) {
          reply(404, {error: 'Session already gone'});
          return;
        }
        await bridge.detach(sessionId);
        reply(200, {ok: true});
        return;
      }
      reply(404, {error: 'Unknown manager operation'});
    } catch (error) {
      reply(400, {
        error:
          error instanceof Error ? error.message : 'Manager operation failed',
      });
    }
  }
}
