/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {createRequire} from 'node:module';
import path from 'node:path';

// Patchright 1.58.2 supports native downloads internally, but its public API
// only exposes accept/deny. Both persistent launches and CDP attachments default
// to allowAndName, replacing Chrome's delegate, directory and filename handling.
// Set the existing internal mode before the default context is initialized.
// Sending behavior:default afterward still leaves the DevTools delegate installed
// and crashes the existing Cesar profile in Chrome 153.0.8010.37.
const require = createRequire(import.meta.url);
const packageRoot = path.dirname(
  require.resolve('patchright-core/package.json'),
);
interface BrowserOptions {
  persistent?: {acceptDownloads?: string};
}
interface ChromiumBrowser {
  connect(
    parent: unknown,
    transport: unknown,
    options: BrowserOptions,
    devtools?: unknown,
  ): Promise<unknown>;
}
const {CRBrowser} = require(
  path.join(packageRoot, 'lib/server/chromium/crBrowser.js'),
) as {CRBrowser: ChromiumBrowser};
const connect = CRBrowser.connect;
CRBrowser.connect = function (parent, transport, options, devtools) {
  if (options.persistent) {
    options = {
      ...options,
      persistent: {
        ...options.persistent,
        acceptDownloads: 'internal-browser-default',
      },
    };
  }
  return connect.call(this, parent, transport, options, devtools);
};
