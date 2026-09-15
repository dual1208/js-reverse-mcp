# Arch Linux / Wayland handoff

## Goal

Make JS-Reverse MCP and OpenCLI usable in the user's Arch Linux Wayland desktop,
with persistent Cesar and Tyson browser identities and independent Codex/Pi
browser assignments. OpenCLI must use Cesar. Preserve the user's existing browser
state and make startup, shutdown, and connection cleanup understandable.

## Starting point

- Repository: https://github.com/dual1208/js-reverse-mcp, branch `main`.
- Implementation checkpoint: `bce4136` (subsequent commits add these handoffs).
- Read [deployment.md](docs/deployment.md),
  [ADR 0002](docs/adr/0002-portable-hosting-and-opencli.md), and
  [CONTEXT.md](CONTEXT.md) before changing the design.
- Shared deployment code is in `scripts/browser_services/`. Its public command
  entry is `scripts/managed.py`; browser services and MCP routing are in
  `src/managed/`. macOS launchd/signing/menu code is isolated in `macos/`.
- OpenCLI 1.8.7 is a pinned npm dependency. `src/opencli.ts` invokes the local
  package with explicit Cesar selection. The bridge version/revision/file hashes
  are in `integrations/opencli/bridge-lock.json`.

Already observed: the portable deployment tests and real headless Chrome MCP
integration passed on GitHub's Ubuntu, Windows, and macOS runners. They covered
separate workers, retained bindings, native downloads, and cleanup when a service
or its supervisor dies. OpenCLI `doctor` also passed in the existing Cesar browser
on the source Mac. None of that establishes a working Arch Wayland desktop,
Linux keyring access, or authentication on this machine.

The initial full CI runs exposed personal-home assumptions in CLI tests and
metadata scripts. Those were fixed; the entire presubmit subsequently passed
locally with an empty home. A follow-up CI run was dispatched, but further testing
was stopped at the user's request. Do not treat that follow-up as verified green.
**Do not start another broad test or benchmark campaign merely to resume this
handoff. Inspect the destination, perform the needed deployment, and check the
specific native behavior being delivered.**

## Destination discovery

Start by inspecting this machine's existing configuration and running Chrome
owners. Resolve which user data directories really contain Cesar and Tyson; do
not transplant the Mac paths from older notes or pick a profile by window title.
`chrome://version` shows the actual Profile Path. Register the parent of `Default`,
not `Default` itself. The two identities need separate, non-nested roots.

Check the installed Chrome GUI application, Node, npm, Python, compositor, session
bus, and password-store availability. Work as the logged-in desktop user. Preserve
`WAYLAND_DISPLAY`, `DISPLAY`, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS`.
Do not start these headed browsers as root or from an SSH environment missing the
desktop session. Do not replace the real Chrome app with a different browser to
make a check pass.

## Chrome and repository dependencies

Install only missing prerequisites. Official Arch packages are recorded in
[deployment/arch/packages.txt](deployment/arch/packages.txt):

```sh
sudo pacman -S --needed base-devel git nodejs npm python
```

Google Chrome is the **google-chrome AUR package**. It is not an official
`pacman -S google-chrome` package. Use the current PKGBUILD for the destination's
architecture, review it, and build as the normal user:

```sh
git clone https://aur.archlinux.org/google-chrome.git
cd google-chrome
less PKGBUILD
makepkg -si
```

`makepkg -si` uses pacman to install dependencies and the resulting package;
`pacman -U` can install an already-built package. The official `chromium` package
is a different browser and does not satisfy the configured `chrome` channel.
Do not perform an unrelated OS or dependency upgrade as part of this handoff.

In the JS-Reverse checkout, install/build when needed:

```sh
npm ci
npm run build
```

Supported prerequisites: Python 3.10+, Node 22.12+ or another release supported
by `package.json`, and a working interactive Google Chrome stable installation.

## Deploy the native desktop path

1. If destination profiles already exist, preserve them and stop only their
   dedicated current owner before handing ownership over. If an identity does
   not exist, have the user establish it in a dedicated Chrome user data
   directory and complete its ordinary login first. The deployer refuses missing
   `Default/Preferences`; it does not create or copy browser identities.
2. Prepare a release, substituting the actual destination paths:

   ```sh
   python scripts/managed.py prepare --cesar "/actual/cesar/root" --tyson "/actual/tyson/root" --with-opencli
   python scripts/managed.py serve
   ```

   Existing paths can be retained by omitting the two profile options on an
   upgrade. `prepare` requires running managed services to be stopped. It
   installs a private release's production dependencies from the lockfile.

3. Keep the supervisor in the logged-in Wayland desktop. From another terminal:

   ```sh
   python scripts/managed.py status
   python scripts/managed.py mcp-config
   ```

   The second command prints the facade command/args/env for the current release.
   Apply it to the actual Codex/Pi configuration, preserving unrelated entries.
   Set `JS_REVERSE_HARNESS` appropriately. A shared MCP transport must pass the
   real conversation ID to `select_browser` and retain its returned
   `browserSession`; the server cannot infer that ID from stdio.

4. Native work still needed: confirm windows appear in the intended compositor,
   the profile's normal password store is usable, and Chrome settings govern
   actual download directory/naming. Establish one useful browser assignment
   from each installed harness and verify stopping a worker leaves Chrome open.
   Inspect current live state before asking the user to log in again.

The default config is `~/.config/js-reverse-manager/config.json`; state defaults
to `~/.local/share/js-reverse-manager`. Use `--config` or
`JS_REVERSE_MANAGER_CONFIG` consistently if choosing another location.

## OpenCLI and account continuity

```sh
npm run opencli -- profile list
npm run opencli -- profile rename CONTEXT_ID cesar
npm run opencli -- doctor
```

Match the context ID against the OpenCLI extension popup in the actual Cesar
window before renaming. Retain an existing correct alias. The wrapper always
requests Cesar and rejects an extra `--profile`; it must fail when Cesar is
unavailable instead of selecting another identity.

When the user needs these services on this machine, confirm with their read-only
account commands: `notebooklm whoami`, `gemini whoami`, `reddit whoami`,
`twitter whoami`, and `jimeng whoami`, each after `npm run opencli --`.
A Mac login does not authenticate this Linux profile. Use normal user-led login
when needed; do not export or transfer plaintext passwords/cookies. An aborted
navigation alone is not proof of sign-out.

## Remaining platform decisions and boundaries

- The current Linux implementation is a foreground supervisor. No systemd user
  unit or desktop autostart entry has been installed here. If persistent startup
  is needed, implement it as a Linux adapter consuming the shared service layer,
  tied to the actual graphical session and its environment. Decide the concrete
  compositor/session integration from destination evidence.
- There is no Wayland menu/tray implementation. The three-level native menu is
  macOS-only. `status` supplies the profile → JS-Reverse worker → CDP-session
  inventory; `disconnect INSTANCE_ID` revokes one worker's connection.
- OpenCLI's extension owns a separate connection through its daemon. Its own
  debugger attachments are not included in the JS-Reverse gateway's inventory.
- Ctrl+C stops the foreground group through private lifetime pipes. EOF also
  closes services after a parent crash. A service failure exits visibly rather
  than entering a hidden restart loop.
- A hard supervisor crash can leave `<config>.operation`. Inspect its `owner.json`
  and verify that PID has exited before removing only that directory. Never
  delete browser locks or kill unrelated Chrome processes to force startup.
- Existing releases and private backups support recovery. Keep them until the
  destination deployment is usable. Keep profiles, logs, credentials, and runtime
  configuration outside Git.

Continue with focused commits and explanatory messages. Report actual native
observations and remaining gaps; do not substitute headless Ubuntu evidence for
Wayland acceptance. Push authorized repository changes so both platform checkouts
can share improvements, while keeping OS-specific hosting code separate.
