/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {rmSync} from 'node:fs';

import {readConfig, runtimePath, writePrivateJSON} from './config.js';
import {ConnectionManager} from './manager.js';

const config = readConfig();
const manager = new ConnectionManager(config);
await manager.listen();
writePrivateJSON(runtimePath(config), {
  url: manager.url,
  token: manager.token,
  pid: process.pid,
});
console.error(`JS-Reverse connection manager ready; PID ${process.pid}`);
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  rmSync(runtimePath(config), {force: true});
  await manager.close();
  process.exit(0);
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
