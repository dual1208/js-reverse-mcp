/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {existsSync, realpathSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {profileNames, readConfig} from './managed/config.js';

export const REQUIRED_PROFILE = path.join(
  os.homedir(),
  '.local',
  'share',
  'js-reverse-mcp',
  'active-profile',
);

export function requireSelectedProfile(options: {
  userDataDir?: string;
  isolated?: boolean;
  cloak?: boolean;
  browserUrl?: string;
}): void {
  // External CDP is a lifecycle policy, not a Chrome limit on client count.
  // Workers may attach only to their manager-issued endpoint/capability.
  if (
    options.browserUrl &&
    process.env.JS_REVERSE_CONNECTION_TOKEN &&
    options.browserUrl === process.env.JS_REVERSE_BROWSER_URL &&
    !options.isolated &&
    !options.cloak
  ) {
    const url = new URL(options.browserUrl);
    if (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      /^\/instances\/[\w-]+\/$/.test(url.pathname)
    )
      return;
    throw new Error('Managed workers require a loopback manager endpoint');
  }
  const host = profileNames.find(
    name => name === process.env.JS_REVERSE_PROFILE_HOST,
  );
  if (
    host &&
    !options.browserUrl &&
    !options.isolated &&
    !options.cloak &&
    options.userDataDir
  ) {
    const expected = readConfig().profiles[host];
    if (
      existsSync(path.join(expected, 'Default', 'Preferences')) &&
      realpathSync(options.userDataDir) === realpathSync(expected)
    )
      return;
    throw new Error(
      `Profile host ${host} must use its registered existing directory`,
    );
  }
  if (options.isolated || options.cloak || options.browserUrl) {
    throw new Error(
      'This local JS-Reverse installation always uses the selected browser profile; isolated, cloak, and external CDP modes are disabled.',
    );
  }
  if (!existsSync(path.join(REQUIRED_PROFILE, 'Default', 'Preferences'))) {
    throw new Error(
      `Required selected browser profile copy is missing: ${REQUIRED_PROFILE}. Refusing to create an empty profile.`,
    );
  }
  if (
    options.userDataDir &&
    (!existsSync(options.userDataDir) ||
      realpathSync(options.userDataDir) !== realpathSync(REQUIRED_PROFILE))
  ) {
    throw new Error(
      `This local JS-Reverse installation requires selected browser profile at ${REQUIRED_PROFILE}.`,
    );
  }
}
