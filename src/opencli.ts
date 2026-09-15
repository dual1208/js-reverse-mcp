#!/usr/bin/env node
/**
 * @license
 * Copyright 2026
 * SPDX-License-Identifier: Apache-2.0
 */
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

// Resolve the repository/release dependency, never a global binary on PATH.
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args.some(arg => arg === '--profile' || arg.startsWith('--profile='))) {
  console.error('This integration selects Cesar. Omit --profile.');
  process.exitCode = 2;
} else {
  const child = spawn(
    process.execPath,
    [require.resolve('@jackwener/opencli'), '--profile', 'cesar', ...args],
    {stdio: 'inherit', env: {...process.env, OPENCLI_PROFILE: 'cesar'}},
  );
  child.on('error', error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', code => {
    process.exitCode = code ?? 1;
  });
}
