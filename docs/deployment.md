# Deploy JS-Reverse and OpenCLI

Use this guide for this fork's managed browsers. The upstream `npx js-reverse-mcp`
examples elsewhere in the README do not deploy this fork's profile manager or
OpenCLI integration.

## What runs where

| Module                                                  | Responsibility                                                                                | Platforms             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------- |
| `src/managed/`                                          | CDP gateway/inventory, profile policy, MCP facade, per-conversation workers and Chrome hosts  | Windows, Linux, macOS |
| `scripts/browser_services/deployment.py`                | Validate existing identities, stage independent releases, activate configuration, control API | Windows, Linux, macOS |
| `scripts/browser_services/foreground.py`                | Own the manager and two browser hosts in the current desktop; stop the group on exit/failure  | Windows, Linux, macOS |
| `scripts/browser_services/opencli.py`, `src/opencli.ts` | Verify/install the locked extension and invoke the pinned CLI in Cesar                        | Windows, Linux, macOS |
| `macos/manage.py`, `macos/JSReverseMenu/`               | launchd, Swift build/signing, app placement, three-level native menu                          | macOS only            |

Wayland is the Linux desktop/display environment, not a separate operating
system. Run headed Chrome in your logged-in desktop session. The foreground
supervisor inherits its display and session-bus environment. It is not a root
service, an SSH-only desktop substitute, or a Windows service in Session 0.

The facade supplies one worker per conversation/profile binding. Chrome persists
when an MCP client disconnects. Stopping the **host supervisor** closes its Chrome
processes; it preserves the user data directories. OpenCLI's daemon has a separate
lifetime and can stay running with its extension disconnected.

## Prerequisites and the real Chrome GUI app

Use Node.js 22.12+ (or a supported newer release), npm, Python 3.10+, Git, and
**Google Chrome stable**. Chrome must already work interactively as this desktop
user. Patchright uses the installed `chrome` channel; this setup does not download
a second browser or substitute Chromium. macOS also needs Xcode command-line tools
with Swift 6 and macOS 14+ for the menu app.

### Windows: WinGet

In a normal interactive PowerShell window:

```powershell
winget install --id Google.Chrome --exact --source winget
winget install --id OpenJS.NodeJS.LTS --exact --source winget
winget install --id Python.Python.3.13 --exact --source winget
winget install --id Git.Git --exact --source winget
```

Install only missing prerequisites. Reopen PowerShell after installation so PATH
contains Node, npm, Python and Git. The repeatable Chrome-only helper is
`deployment/windows/install-chrome.ps1`. Verify `node --version`, `npm --version`,
`python --version`, and launch Chrome from Start. WinGet may request elevation for
Chrome's installer; run the browser services as your normal desktop user afterward.

The package ID comes from Microsoft's
[Google.Chrome manifest](https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/Google/Chrome);
see [WinGet's install command](https://learn.microsoft.com/en-us/windows/package-manager/winget/install).

### Arch Linux / Wayland: pacman and the Google Chrome AUR package

Install the missing official packages on an up-to-date Arch installation:

```sh
sudo pacman -S --needed base-devel git nodejs npm python
```

`deployment/arch/packages.txt` records these dependencies. Google's branded Chrome
is the [google-chrome AUR package](https://aur.archlinux.org/packages/google-chrome),
not an official `pacman -S google-chrome` package. Build it as your ordinary user:

```sh
git clone https://aur.archlinux.org/google-chrome.git
cd google-chrome
less PKGBUILD
makepkg -si
```

Read the PKGBUILD before building. `makepkg -si` installs dependencies and the built
package through pacman. If it was already built, `sudo pacman -U <package.pkg.tar.zst>`
installs that local package. Do not run makepkg as root. Check the reviewed PKGBUILD's supported
architectures and dependencies for your machine. The official
[chromium package](https://archlinux.org/packages/extra/x86_64/chromium/) is a
different browser and does not satisfy this setup's `chrome` channel.

Launch `google-chrome-stable` from your Wayland desktop and check `chrome://version`.
If Chrome cannot connect to the display or password store, fix that desktop
prerequisite before starting managed hosts. The supervisor preserves
`WAYLAND_DISPLAY`, `DISPLAY`, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS`; it
has no X11 automation dependency. Native Wayland GUI behavior still needs an
acceptance run on your actual compositor.

### macOS

Install Google Chrome in `/Applications/Google Chrome.app`. Install missing Node,
Python and Git prerequisites through your usual package manager, then run
`xcode-select --install` if command-line tools are missing. The menu installer
compiles with `xcrun swiftc`. All identities use the same original Chrome app bundle.

## Build this checkout

```sh
git clone https://github.com/dual1208/js-reverse-mcp.git
cd js-reverse-mcp
npm ci
npm run build
npm run opencli -- --version
```

The same commands work in PowerShell. OpenCLI is installed from the root lockfile;
a global `opencli` is not used by `npm run opencli`. The separately pinned bridge is
provisioned only by `--with-opencli`, not during `npm ci`.

## Register existing Cesar and Tyson identities

Use two distinct **user data directories**, each with `Default/Preferences`.
`chrome://version` reports a Profile Path ending in `Default`; register its parent.
Do not register `Default` itself, two subprofiles under the same browser root, or a
root already owned by another browser process.

On a new machine, first open Chrome manually with a dedicated `--user-data-dir`
for each identity, sign in normally, and close those dedicated browser windows.
For example on Arch:

```sh
google-chrome-stable --user-data-dir="$HOME/.local/share/js-reverse/cesar"
google-chrome-stable --user-data-dir="$HOME/.local/share/js-reverse/tyson"
```

On Windows use Chrome's installed executable with the same `--user-data-dir=`
argument and separate absolute directories under your user account. Existing
identities need no recreation. The installer deliberately refuses missing or empty
replacement profiles. Credentials stay local; copying a Mac profile does not
transfer its Keychain encryption to Windows or Linux.

### Windows and Wayland: portable supervisor

Replace both example paths with the existing roots on this machine:

```sh
python scripts/managed.py prepare --cesar "/absolute/cesar" --tyson "/absolute/tyson" --with-opencli
python scripts/managed.py serve
```

In PowerShell the paths can be `"C:\Users\you\Browsers\Cesar"` and
`"C:\Users\you\Browsers\Tyson"`. On macOS use `python3` if `python` is unavailable.
Keep that terminal open. After `{"ready": true, ...}`, inspect from another terminal:

```sh
python scripts/managed.py status
python scripts/managed.py mcp-config
python scripts/managed.py disconnect INSTANCE_ID
```

Ctrl+C gracefully stops the group. The supervisor requests shutdown through a
private stdin pipe on every OS, so Windows does not need a console signal to close
Chrome. Closing the pipe also stops the host if its supervisor crashes. A failed service also
stops the group and exits nonzero, with logs naming the failure. A second supervisor
for the same configuration is rejected. There is no automatic destructive cleanup
or endless restart loop.

This release supplies a foreground supervisor for these platforms, not an installed
Windows scheduled task or systemd user unit. For autostart, an interactive logon
task or a service tied to the graphical user session can run the same `serve`
command with absolute Python/script/config paths. Preserve its desktop environment
and graceful supervisor shutdown; do not use a service manager's force-end operation
as a normal shutdown path. Validate foreground operation first.

### macOS: launchd and menu

```sh
python3 scripts/managed.py install --cesar "/absolute/cesar" --tyson "/absolute/tyson" --with-opencli
python3 scripts/managed.py status
python3 scripts/managed.py menu
```

An existing installation retains its profile paths when those options are omitted.
`install` prepares a new release and signed menu before stopping the old jobs,
backs up configuration/plists, and starts the replacement jobs. It restarts these
two dedicated browsers. `stop` and `start` operate their four launchd jobs. The
portable `serve` mode is an alternative for testing, not an additional owner to run
beside launchd. The installed app is `~/Applications/JS-Reverse.app`.

## Connect Codex, Pi or another MCP harness

`python scripts/managed.py mcp-config` prints a JSON command/args/env entry with
absolute paths for the current release. Add that entry to the harness's MCP
configuration and set `JS_REVERSE_HARNESS` to a useful owner label (`codex` or `pi`).
Use the **facade** `managed/routerMain.js`, rather than the internal `index.js`
worker. Restart/reconnect the harness after changing its MCP configuration.

Call `select_browser` for a new activity, pass the actual conversation ID when the
harness supplies it, and retain the returned `browserSession` on every browser
operation. Existing bindings remain on their profile through redirects and OAuth.
Indexed OpenCLI/social/Google/cloud services select Cesar; learning/general work
selects Tyson. An explicit profile choice takes precedence on a new activity.

The companion [agent-tool-routing](https://github.com/dual1208/agent-tool-routing)
repository maintains Codex/Pi configuration and the `browse` skill on this user's
machines. Its Pi adapter supplies the actual conversation ID. Without that adapter,
a harness sharing one MCP transport across conversations must supply IDs and retain
handles itself; this repository does not infer conversation IDs from stdio.

## OpenCLI in Cesar

After preparing/installing with `--with-opencli` and starting the browser hosts:

```sh
npm run opencli -- profile list
npm run opencli -- profile rename CONTEXT_ID cesar
npm run opencli -- doctor
```

On first setup, identify Cesar's context ID in the OpenCLI extension popup in the
Cesar window and match it to `profile list`; do not guess among multiple profiles.
Skip renaming when the existing `cesar` alias already points there. The wrapper
always passes `--profile cesar`, so a disconnected Cesar fails instead of silently
using another browser. No global default or shell variable is needed.

Confirm site authentication independently, without posting or creating content:

```sh
npm run opencli -- notebooklm whoami
npm run opencli -- gemini whoami
npm run opencli -- reddit whoami
npm run opencli -- twitter whoami
npm run opencli -- jimeng whoami
```

If a site is signed out, open it in Cesar and complete its ordinary login.
`Navigation rejected` or `net::ERR_ABORTED` alone does not prove sign-out: inspect
the live page and retry its account check after redirects settle. Bridge health
and website authentication are separate checks. See the
[integration contract](../integrations/opencli/README.md) and
[upstream Browser Bridge guide](https://github.com/jackwener/OpenCLI/blob/8271afc67e8504bda94c147f446ee29775d08274/docs/guide/browser-bridge.md).

## Upgrade, recover and verify

The default private configuration is `~/.config/js-reverse-manager/config.json`
on all three platforms, retaining the existing layout. Override it with `--config`
or `JS_REVERSE_MANAGER_CONFIG`; pass the same path to the harness. State defaults to
`~/.local/share/js-reverse-manager`; browser data remains at the registered paths.
Use a private home directory with appropriate Windows ACLs; POSIX mode bits alone
do not express Windows access control.

`prepare` stages built source and runs `npm ci --omit=dev --ignore-scripts` inside
a new release. It needs npm registry access and keeps its own production dependencies,
so subsequent checkout rebuilds or dependency updates cannot change that release.
These releases are for the machine/OS where they were prepared. Run `prepare`
again on another OS; do not copy `node_modules` between platforms.

For a portable upgrade, stop `serve`, build the checkout, then run `prepare` and
`serve` again. For launchd, build and run `install`. Refresh harness entries with
`mcp-config` afterward. The CLI in the active release is
`<release>/build/src/opencli.js`; invoking it with Node uses that release's pinned
OpenCLI. The checkout's `npm run opencli` follows the checkout's own lockfile.

Logs live in `<stateDir>/logs/`; backups live in `<stateDir>/backups/<release>/`.
If activation fails, the old configuration remains; staging does not change live
services. If starting a newly activated release fails, stop its supervisor, restore
the previous backed-up configuration (and launchd plists on macOS), and start the
old release. Retain the old release until recovery is verified.

A directory named `<config filename>.operation` excludes overlapping deployment or
foreground owners. If its owner crashed, inspect `owner.json` and verify that PID
has exited before removing only that lock directory. Never delete profile locks or
kill unrelated Chrome processes to make installation succeed.

Checks from this checkout:

```sh
npm run presubmit
python -m unittest discover -s tests/deployment -v
```

With Google Chrome installed, enable `JS_REVERSE_INTEGRATION=1` and rerun the Python
suite plus `node --test build/tests/managed.integration.test.js`. In PowerShell,
set `$env:JS_REVERSE_INTEGRATION='1'`; in a POSIX shell prefix the command with
`JS_REVERSE_INTEGRATION=1`. The browser tests use disposable profiles, including
actual downloads, worker isolation, and supervisor failure cleanup. CI runs the
portable deployment contract and headless Chrome checks on three operating systems.
These checks do not establish interactive Wayland behavior or website login state.
