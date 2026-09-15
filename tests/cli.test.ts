/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';

// Policy resolves the selected profile at module load. Use an isolated home
// before importing it; neither CI nor another contributor owns this Mac's copy.
const home = mkdtempSync(path.join(os.tmpdir(), 'js-reverse-cli-test-'));
const previous = {HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE};
process.env.HOME = home;
process.env.USERPROFILE = home;
const {parseArguments} = await import('../src/cli.js');
const {REQUIRED_PROFILE} = await import('../src/profilePolicy.js');
mkdirSync(path.join(REQUIRED_PROFILE, 'Default'), {recursive: true});
writeFileSync(path.join(REQUIRED_PROFILE, 'Default/Preferences'), '{}');
after(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(home, {recursive: true, force: true});
});

test('legacy launch rejects a missing profile without creating it', () => {
  const emptyHome = path.join(home, 'empty-home');
  mkdirSync(emptyHome);
  const result = spawnSync(
    process.execPath,
    [path.resolve(import.meta.dirname, '../src/index.js')],
    {
      env: {...process.env, HOME: emptyHome, USERPROFILE: emptyHome},
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Required selected browser profile copy is missing/,
  );
  assert.equal(
    existsSync(
      path.join(emptyHome, '.local/share/js-reverse-mcp/active-profile'),
    ),
    false,
  );
});

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
