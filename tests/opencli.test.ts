/**
 * @license
 * Copyright 2026
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

test('OpenCLI runs the locked local package without a global executable', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'opencli-test-'));
  try {
    const result = spawnSync(
      process.execPath,
      [path.resolve(import.meta.dirname, '../src/opencli.js'), '--version'],
      {
        env: {...process.env, PATH: '', HOME: home, USERPROFILE: home},
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^1\.8\.7\s*$/);
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
});

test('OpenCLI integration rejects profile overrides before invoking commands', () => {
  for (const override of [['--profile', 'tyson'], ['--profile=tyson']]) {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../src/opencli.js'),
        ...override,
        'doctor',
      ],
      {encoding: 'utf8', timeout: 5_000},
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /selects Cesar/);
    assert.equal(result.stdout, '');
  }
});
