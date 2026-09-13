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
import {REQUIRED_PROFILE} from '../src/profilePolicy.js';

test('parseArguments accepts a dedicated user-data directory', () => {
  const parsed = parseArguments('test', [
    'node',
    'js-reverse-mcp',
    '--userDataDir',
    REQUIRED_PROFILE,
  ]);

  assert.equal(parsed.userDataDir, REQUIRED_PROFILE);
  assert.equal(parsed.isolated, false);
});

test('parseArguments rejects a user-data directory in isolated mode', () => {
  const entrypoint = path.resolve(import.meta.dirname, '../src/index.js');
  const result = spawnSync(
    process.execPath,
    [entrypoint, '--userDataDir', REQUIRED_PROFILE, '--isolated'],
    {encoding: 'utf8'},
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /always uses the selected browser profile/);
});

for (const flags of [
  ['--userDataDir', '/tmp/wrong-profile'],
  ['--isolated'],
  ['--cloak'],
  ['--browserUrl', 'http://127.0.0.1:9222'],
]) {
  test(`profile policy rejects ${flags[0]}`, () => {
    const entrypoint = path.resolve(import.meta.dirname, '../src/index.js');
    const result = spawnSync(process.execPath, [entrypoint, ...flags], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /selected browser profile/);
  });
}
