# Windows handoff

## Goal

Make JS-Reverse MCP and OpenCLI usable in the user's Windows desktop, with
persistent Cesar and Tyson browser identities and independent Codex/Pi browser
assignments. OpenCLI must use Cesar. Preserve existing browser state and provide
clear startup, shutdown, and connection cleanup.

## Starting point

- Repository: https://github.com/dual1208/js-reverse-mcp, branch `main`.
- Implementation checkpoint: `bce4136` (subsequent commits add these handoffs).
- Read [deployment.md](docs/deployment.md),
  [ADR 0002](docs/adr/0002-portable-hosting-and-opencli.md), and
  [CONTEXT.md](CONTEXT.md).
- `scripts/managed.py` is the command interface.
  `scripts/browser_services/` owns portable release preparation, configuration,
  OpenCLI provisioning, and foreground service lifetime.
- `src/managed/` contains the same manager, hosts, facade, worker routing and
  policy used on macOS. launchd/signing/menu code lives separately in `macos/`.
- OpenCLI 1.8.7 is pinned in this checkout; `src/opencli.ts` always selects Cesar.
  Bridge assets are pinned and hash-checked by
  `integrations/opencli/bridge-lock.json`.

Already observed: real headless Chrome and portable deployment checks passed on
GitHub's **Windows runner**, as well as Ubuntu and macOS. These included separate
workers, profile bindings, native downloads, and cleanup after service/supervisor
failure. They do not establish that this destination's interactive desktop,
account state, installed harnesses or logon startup work.

Full-suite CI exposed personal-home assumptions in older CLI tests and metadata
scripts. Those were fixed, and the complete presubmit passed locally with an empty
home. A follow-up CI run was dispatched, but further testing was stopped at the
user's request; do not assume it is green. **Do not begin another broad test or
benchmark campaign just to resume this handoff. Inspect the destination, perform
the needed deployment, and check the specific native behavior being delivered.**

## Destination discovery and prerequisites

Use native Windows PowerShell and the logged-in desktop user. Do not implement
this through WSL or a service running in Session 0. First inspect existing manager
configuration, installed tools, actual Chrome processes, and the user data roots
that contain Cesar and Tyson. Preserve unrelated browser windows and harness
configuration.

Install only missing prerequisites:

```powershell
winget install --id Google.Chrome --exact --source winget
winget install --id OpenJS.NodeJS.LTS --exact --source winget
winget install --id Python.Python.3.13 --exact --source winget
winget install --id Git.Git --exact --source winget
```

A repeatable Chrome-only helper is
[deployment/windows/install-chrome.ps1](deployment/windows/install-chrome.ps1).
Chrome's installer may request elevation; run the browser services as the normal
desktop user afterward. Reopen PowerShell if PATH has not refreshed.

Use the real Google Chrome stable GUI app. Do not replace it with Chromium or
create renamed/re-signed browser copies. Python 3.10+ and Node 22.12+ (or another
version supported by `package.json`) are required. The deployer invokes Node
executables directly and runs npm's JavaScript entry on Windows rather than
assuming a `.cmd` file behaves like a Unix executable.

In the repository:

```powershell
npm ci
npm run build
```

Do not upgrade unrelated working software as a prerequisite to this work.

## Register the actual Windows identities

`chrome://version` shows the **Profile Path**. Register the parent directory of
`Default`, not `Default` itself. Cesar and Tyson must use separate, non-nested user
data roots. Do not substitute the source Mac's paths, or register two Chrome
subprofiles inside one shared root as separate browser instances.

If the identities already exist here, preserve them and stop only their dedicated
current owner before transferring ownership. If they do not exist, establish each
through Chrome's ordinary `--user-data-dir=<absolute directory>` launch and let
the user sign in, then close that dedicated browser. Discover the installed Chrome
executable rather than hardcoding a path when the destination differs.

The installer refuses missing `Default\Preferences`; it does not create empty
replacement identities. A copied Mac profile does not transfer its Keychain
credentials to Windows. Never export plaintext passwords or cookies for migration.

## Deploy the foreground Windows path

Substitute the verified absolute Windows roots:

```powershell
python scripts/managed.py prepare --cesar "C:\Users\you\Browsers\Cesar" --tyson "C:\Users\you\Browsers\Tyson" --with-opencli
python scripts/managed.py serve
```

Omit the profile options on an upgrade to retain existing configured roots. Stop
managed services before `prepare`; it stages built code and lockfile-pinned
production dependencies in an independent release. Its dependency directory does
not point back into the checkout, and it requires no Unix symlink setup.

After the supervisor reports ready, use another terminal:

```powershell
python scripts/managed.py status
python scripts/managed.py mcp-config
python scripts/managed.py disconnect INSTANCE_ID
```

The default private config is `%USERPROFILE%\.config\js-reverse-manager\config.json`;
state defaults to `%USERPROFILE%\.local\share\js-reverse-manager`. `--config` or
`JS_REVERSE_MANAGER_CONFIG` overrides the config path. Keep that choice consistent
in the supervisor and harness. Protect these directories with the user's Windows
ACLs; POSIX mode bits are not a Windows access-control policy.

Apply the generated MCP command/args/env to the actual Codex/Pi installation while
preserving unrelated settings. Use the facade `managed\routerMain.js`, not the
internal worker `index.js`. Set `JS_REVERSE_HARNESS` to a useful owner label.
A harness sharing an MCP transport across conversations must pass actual
conversation IDs to `select_browser` and keep each returned `browserSession`.
The companion agent-tool-routing Pi adapter supplies that ID; inspect the actual
installation before assuming it is present.

Native work still needed: confirm usable headed windows with the right identity,
normal profile download behavior, and one useful assignment through each installed
harness. A worker disconnect must leave Chrome open. Observe existing login state
before asking the user to authenticate again.

## OpenCLI in Cesar

```powershell
npm run opencli -- profile list
npm run opencli -- profile rename CONTEXT_ID cesar
npm run opencli -- doctor
```

Match the context ID to the OpenCLI extension popup in the real Cesar window;
retain an already-correct alias. The wrapper uses the checkout's pinned package,
not a global `opencli`, and always requests Cesar. Do not add `--profile` to wrapper
commands or configure fallback to whichever browser happens to be available.

For the requested services, account checks are `notebooklm whoami`, `gemini whoami`,
`reddit whoami`, `twitter whoami`, and `jimeng whoami`, each following
`npm run opencli --`. These do not post or create content. Perform them as needed
for the destination setup. The source Mac's authentication does not prove Windows
is signed in. Use ordinary user-led login when required; an aborted redirect alone
is not a sign-out verdict.

## Windows lifetime and remaining work

- The current Windows implementation is a foreground supervisor. No scheduled
  task, service, or tray app has been installed on this destination.
- Browser hosts have **private stdin lifetime pipes**. The supervisor requests
  graceful shutdown through those pipes; EOF also shuts hosts down if the parent
  dies. This works without Windows console-signal delivery. Do not replace normal
  shutdown with `taskkill /F`, `TerminateProcess`, or broad Chrome process kills.
- Ctrl+C is the ordinary foreground stop action. It closes the two owned browser
  processes while retaining their user data. Disconnecting an MCP worker is a
  different operation and keeps the browser running.
- If logon startup is needed, implement a Windows adapter using the shared layer
  in the interactive user session. Determine paths, account, working directory,
  shutdown behavior and upgrade/recovery from the actual machine. Do not claim
  that a scheduled task running while logged out can supply this headed desktop.
- The native three-level menu is macOS-only. Until a Windows UI is explicitly
  implemented, `status` provides profile → JS-Reverse worker → CDP-session
  inventory, and `disconnect` revokes a selected worker.
- OpenCLI uses its own extension/daemon connection. Its debugger attachments are
  outside the JS-Reverse gateway's managed session tree.
- Logs and backups live under the configured state directory. Retain old releases
  until the new deployment is usable. A hard parent crash may leave
  `<config>.operation`; inspect `owner.json` and verify the PID has exited before
  removing only that lock. Never delete profile locks to force startup.

Continue with focused commits and clear messages. Preserve the shared core when
adding Windows-specific hosting. Keep runtime configuration, profiles, credentials
and logs out of Git. Report what actually works in the native desktop and what
remains, then push authorized repository changes for reuse by the other platform.
