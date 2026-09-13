/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {readFileSync, rmSync} from 'node:fs';
import path from 'node:path';

import {closeBrowserResult, launch} from '../browser.js';

import {profileNames, readConfig, writePrivateJSON} from './config.js';

const name = profileNames.find(value => value === process.argv[2]);
if (!name) throw new Error('Expected profile name cesar or tyson');
const config = readConfig();
process.env.JS_REVERSE_PROFILE_HOST = name;
const stateFile = path.join(config.stateDir, `${name}.json`);
rmSync(stateFile, {force: true});
const result = await launch({
  isolated: false,
  userDataDir: config.profiles[name],
  remoteDebuggingPort: 0,
  headless: process.env.JS_REVERSE_TEST_HEADLESS === '1',
});
const [port, socketPath] = readFileSync(
  path.join(config.profiles[name], 'DevToolsActivePort'),
  'utf8',
)
  .trim()
  .split('\n');
if (!/^\d+$/.test(port) || !socketPath.startsWith('/devtools/browser/')) {
  await closeBrowserResult(result, 'Invalid debugging endpoint');
  throw new Error('Chrome did not publish its debugging endpoint');
}
writePrivateJSON(stateFile, {
  pid: process.pid,
  endpoint: `ws://127.0.0.1:${port}${socketPath}`,
  startedAt: new Date().toISOString(),
});
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  rmSync(stateFile, {force: true});
  const deadline = setTimeout(() => process.exit(1), 10_000);
  await closeBrowserResult(result, 'Profile host stopped');
  clearTimeout(deadline);
  process.exit(0);
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
result.context.on('close', () => {
  void stop();
});
console.error(`Profile ${name} ready; host PID ${process.pid}`);
