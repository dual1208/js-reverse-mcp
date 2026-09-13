/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {test} from 'node:test';

import WebSocket, {WebSocketServer} from 'ws';

import type {ManagerConfig} from '../src/managed/config.js';
import {ConnectionManager} from '../src/managed/manager.js';
import {chooseProfile} from '../src/managed/policy.js';
import {SessionTracker} from '../src/managed/SessionTracker.js';

const config: ManagerConfig = {
  version: 1,
  stateDir: '/tmp/unused',
  workerEntry: '/tmp/unused',
  allowedRoots: ['/tmp'],
  profiles: {cesar: '/tmp/cesar', tyson: '/tmp/tyson'},
};

test('profile policy uses service boundaries, explicit choice and purpose fallback', () => {
  for (const url of [
    'https://openrouter.ai/models',
    'https://console.cloud.google.com',
    'https://my.vultr.com',
    'https://x.com',
  ]) {
    assert.equal(
      chooseProfile({purpose: 'service task', url}).profile,
      'cesar',
    );
  }
  for (const url of [
    'https://grementor.ets.org',
    'https://openrouter.ai.example.org',
    'https://example.org/?next=google.com',
  ]) {
    assert.equal(chooseProfile({purpose: 'browse', url}).profile, 'tyson');
  }
  assert.equal(
    chooseProfile({
      purpose: 'new VM provider',
      url: 'https://unknown.example',
      service: 'cloud',
    }).profile,
    'cesar',
  );
  assert.equal(
    chooseProfile({purpose: 'practice', service: 'learning'}).profile,
    'tyson',
  );
  assert.equal(
    chooseProfile({
      purpose: 'explicit override',
      profile: 'tyson',
      url: 'https://drive.google.com',
    }).profile,
    'tyson',
  );
});

test('session tracker covers nested auto-attachments, explicit attachment responses and target updates', () => {
  const tracker = new SessionTracker('connection');
  const response = (message: unknown) =>
    tracker.observe(JSON.stringify(message), 'response');
  response({
    method: 'Target.attachedToTarget',
    params: {
      sessionId: 'parent',
      targetInfo: {
        targetId: 'page',
        type: 'page',
        url: 'https://user:password@example.org/a?token=secret#fragment',
      },
    },
  });
  response({
    sessionId: 'parent',
    method: 'Target.attachedToTarget',
    params: {
      sessionId: 'child',
      targetInfo: {targetId: 'worker', type: 'worker'},
    },
  });
  tracker.observe(
    JSON.stringify({
      id: 1,
      method: 'Target.attachToTarget',
      params: {targetId: 'page'},
    }),
    'request',
  );
  response({id: 1, result: {sessionId: 'explicit'}});
  assert.equal(tracker.sessions.size, 3);
  assert.equal(tracker.sessions.get('parent')?.url, 'https://example.org/a');
  response({
    method: 'Target.targetInfoChanged',
    params: {
      targetInfo: {
        targetId: 'page',
        type: 'page',
        title: 'Updated',
        url: 'https://example.org/b',
      },
    },
  });
  assert.equal(tracker.sessions.get('explicit')?.title, 'Updated');
  response({
    method: 'Target.detachedFromTarget',
    params: {sessionId: 'parent'},
  });
  assert.deepEqual([...tracker.sessions.keys()], ['explicit']);
});

test('gateway relays two independent clients, inventories sessions, detaches and revokes only one instance', async () => {
  const upstream = new WebSocketServer({host: '127.0.0.1', port: 0});
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const received: unknown[] = [];
  upstream.on('connection', socket => {
    socket.on('message', data => {
      const message = JSON.parse(data.toString()) as {
        id: number;
        method: string;
        params?: {sessionId: string};
      };
      received.push(message);
      if (message.method === 'Target.detachFromTarget') {
        socket.send(JSON.stringify({id: message.id, result: {}}));
        socket.send(
          JSON.stringify({
            method: 'Target.detachedFromTarget',
            params: message.params,
          }),
        );
      } else {
        socket.send(data.toString());
        socket.send(
          JSON.stringify({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: `s${message.id}`,
              targetInfo: {targetId: 'target', type: 'page', title: 'Fixture'},
            },
          }),
        );
      }
    });
  });
  const manager = new ConnectionManager(config, () => ({
    pid: process.pid,
    endpoint: `ws://127.0.0.1:${address.port}`,
    startedAt: '',
  }));
  await manager.listen();
  const clients: WebSocket[] = [];
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(`${manager.url}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: `Bearer ${manager.token}`},
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(res.ok, true);
    return (await res.json()) as {
      id: string;
      token: string;
      browserUrl: string;
    };
  };
  try {
    assert.equal((await fetch(`${manager.url}/state`)).status, 403);
    const registrations = await Promise.all(
      ['a', 'b'].map(conversation =>
        request('/instances', {
          profile: 'cesar',
          harness: 'test',
          conversation,
          label: conversation,
        }),
      ),
    );
    const messages: string[][] = [[], []];
    for (const [index, registration] of registrations.entries()) {
      const socket = new WebSocket(
        `${manager.url.replace('http:', 'ws:')}/instances/${registration.id}/cdp`,
        {headers: {Authorization: `Bearer ${registration.token}`}},
      );
      clients.push(socket);
      socket.on('message', data => messages[index].push(data.toString()));
      await once(socket, 'open');
      socket.send(JSON.stringify({id: index + 1, method: 'Fixture.echo'}));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    const tree = manager.state().profiles[0].instances;
    assert.deepEqual(
      tree.map(instance => instance.sessions.length),
      [1, 1],
    );
    assert.equal(manager.state().profiles[1].instances.length, 0);
    await request(
      `/instances/${tree[0].id}/sessions/${tree[0].sessions[0].id}/detach`,
      {},
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(manager.state().profiles[0].instances[0].sessions.length, 0);
    assert.ok(
      !messages[0].some(message => JSON.parse(message).id < 0),
      'manager replies are never leaked to Patchright',
    );
    await request(`/instances/${tree[0].id}/disconnect`, {});
    assert.equal(
      (
        await fetch(`${registrations[0].browserUrl}json/version`, {
          headers: {Authorization: `Bearer ${registrations[0].token}`},
        })
      ).status,
      403,
    );
    assert.equal(clients[1].readyState, WebSocket.OPEN);
    assert.equal(manager.state().profiles[0].instances[1].status, 'connected');
    assert.equal(received.length, 3);
  } finally {
    clients.forEach(client => client.terminate());
    await manager.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
