# OpenCLI integration

This checkout owns the CLI dependency, launch wrapper, bridge lock, and service
policy. No sibling OpenCLI checkout or global npm installation is required.

- CLI: `@jackwener/opencli@1.8.7`, pinned in the root npm lockfile.
- Bridge: 1.0.24 from upstream revision
  `8271afc67e8504bda94c147f446ee29775d08274`; every installed asset is SHA-256 checked
  against `bridge-lock.json`. Upstream code is Apache-2.0; see
  [OpenCLI's license](https://github.com/jackwener/OpenCLI/blob/8271afc67e8504bda94c147f446ee29775d08274/LICENSE).
- Adapter affinity: the separately reviewed snapshot in
  `src/managed/opencli-services.json`. `scripts/sync-opencli-policy.py` refreshes it
  from a reviewed upstream source checkout; installing npm packages never changes
  the profile policy.

After `npm ci` and `npm run build`, `npm run opencli -- <arguments>` resolves the
local dependency and explicitly selects Cesar. `OPENCLI_PROFILE=tyson` in the
parent shell cannot change that selection; an extra `--profile` argument is
rejected. It does not set or modify a global shell preference. Standard OpenCLI
commands retain their upstream behavior, including the user's adapter overrides
in `~/.opencli` and its auto-started daemon on loopback port 19825.

`python scripts/managed.py prepare --with-opencli` provisions the bridge for a
portable deployment; macOS uses `install --with-opencli`. A byte-identical existing
bridge stays at its existing path, preserving Chrome extension storage and its
OpenCLI context ID. A differing existing OpenCLI bridge is reported for explicit
upgrade review. Other configured extensions are retained.

The bridge uses Chrome's extension debugger API through its own daemon. It does
not use JS-Reverse's gateway, and its attachments are not part of the native
profile → JS-Reverse worker → CDP session tree. Both clients share Cesar's cookies,
account state and browser effects. Use separate working tabs for concurrent work.

See [deployment and authentication checks](../../docs/deployment.md#opencli-in-cesar)
for installation, alias binding, upgrades and recovery. No website credentials or
browser data belong in this directory.
