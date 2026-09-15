/**
 * @license
 * Copyright 2026
 * SPDX-License-Identifier: Apache-2.0
 */
import {createInterface} from 'node:readline';

// launchd uses signals; the portable supervisor uses a private stdin pipe. EOF
// also closes the service if its parent crashes. No console or Unix-only signal
// delivery is required on Windows. Call after startup: pipe input is buffered.
export function bindServiceLifetime(stop: () => Promise<void>): void {
  const shutdown = (): void => {
    void stop();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
  if (process.env.JS_REVERSE_SUPERVISED_STDIN === '1') {
    const input = createInterface({input: process.stdin});
    input.on('line', line => {
      if (line === 'shutdown') shutdown();
    });
    input.on('close', shutdown);
  }
  process.on('message', message => {
    if (message === 'shutdown') shutdown();
  });
  if (process.connected) process.on('disconnect', shutdown);
}
