/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';

import {parseArguments} from '../src/cli.js';

test('parseArguments accepts a dedicated user-data directory', () => {
  const parsed = parseArguments('test', [
    'node',
    'js-reverse-mcp',
    '--userDataDir',
    '/tmp/chrome-test-profile',
  ]);

  assert.equal(parsed.userDataDir, '/tmp/chrome-test-profile');
  assert.equal(parsed.isolated, false);
});

test('parseArguments rejects a user-data directory in isolated mode', () => {
  const entrypoint = path.resolve(import.meta.dirname, '../src/index.js');
  const result = spawnSync(
    process.execPath,
    [entrypoint, '--userDataDir', '/tmp/chrome-test-profile', '--isolated'],
    {encoding: 'utf8'},
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /--userDataDir cannot be combined with --isolated/,
  );
});
