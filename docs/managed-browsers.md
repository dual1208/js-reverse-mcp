# Managed profile browsers

For cross-platform setup, Chrome dependencies, and OpenCLI, start with the
[deployment guide](deployment.md). The macOS installer now consumes shared release
preparation from `scripts/browser_services/`; launchd/signing lives in `macos/manage.py`.

The accepted decision is [ADR 0001](adr/0001-shared-profile-browsers.md). Domain terms are defined in [CONTEXT.md](../CONTEXT.md).

```mermaid
flowchart LR
  C[Codex tasks] --> F[MCP facade: explicit activity binding]
  P[Pi conversations] --> F
  F --> A[JS-Reverse worker A]
  F --> B[JS-Reverse worker B]
  F --> D[JS-Reverse worker C]
  A --> M[Managed CDP gateway]
  B --> M
  D --> M
  M --> E[Cesar Chrome]
  M --> T[Tyson Chrome]
  L[User launchd jobs] --> E
  L --> T
  L --> M
  UI[Native menu: profile → instance → all CDP sessions] --> M
```

## Daily use

Use the installed browse skill normally. `select_browser` selects an identity from the activity's initial service/purpose and returns `browserSession` and `conversationId`. Pass that browserSession to every browser tool. Selection does not navigate: `navigate_page` opens the desired URL in the worker's new working tab. Reuse conversationId for a separate activity in the same conversation; omit browserSession on that new selection so policy can choose its profile. A conversation gets one worker per used profile within its MCP connection.

The policy chooses Cesar for OpenCLI-indexed services, social media, OpenRouter, Google and cloud services. This includes OpenCLI's public research and learning adapters; an arXiv or LinkedIn Learning activity starts in Cesar. The skill supplies `service="opencli"` for OpenCLI work, `service="social"` for social media without a known domain, and `service="cloud"` for any VM/cloud provider. Other browsing defaults to Tyson. Explicit profile choice overrides automatic selection. A continuing binding is sticky: an IELTS activity's Google login redirect stays with Tyson; a separate Google Drive activity chooses Cesar. URL substrings and query parameters cannot impersonate a service domain.

The engine reads the checked-in `src/managed/opencli-services.json` snapshot, whose source URL pins the reviewed OpenCLI revision. Refresh it from a local upstream checkout with `python3 scripts/sync-opencli-policy.py /path/to/OpenCLI`, format it, and run the policy tests before deployment. The snapshot combines indexed adapter documentation with registry domains and reviewed front-door aliases. Generic `web` and desktop adapters have no fixed domain; classify those activities as `opencli` instead of treating every website or localhost address as Cesar.

Pi injects its actual session ID through the existing adapter's execution context. Codex's skill supplies the current task ID when available, or keeps the generated conversation ID returned by the first selection. No process-global active profile or guessed MCP-to-task lifetime is required. Browser session handles belong to the facade that created them; reconnecting a harness creates fresh tool state.

The menu is expanded by default: **profile → JS-Reverse instance → every attached CDP session**. The third level includes Patchright's internal page/worker/frame attachments and JS-Reverse's explicit debugger/collector attachments. Parent CDP-session IDs are displayed on rows rather than creating a fourth tree level. The instance row shows its harness, task label, conversation ID and transport count. There is no top-N cutoff; scroll to see all rows.

- **Detach** ends one attachment, preserving the target. Detaching an internal Patchright session may interrupt the worker's tools; explicit per-page sessions can also become unusable until their owner reinitializes them.
- **Disconnect** revokes one instance and drops its CDP transport. The worker exits; Chrome and tabs remain open. Ordinary tool retries cannot reconnect it. `select_browser(reconnect=true)` creates a new worker only when the user asks.
- **Remove** forgets a disconnected instance's menu row. It does not remove a profile or close a tab.
- Tabs, cookies and browser effects are shared within a profile. Separate workers have separate selections and debugger/collector records, but can interfere when deliberately operating on the same page. No paused-frame handoff is implemented.

## Installation and operation

### OpenCLI on Cesar

OpenCLI uses its Browser Bridge extension inside the same managed Cesar browser. Its local context ID is an extension identity, distinct from a CDP session or a JS-Reverse conversation. `opencli profile list` shows connected extension contexts; verify the context in Cesar's extension popup, name it with `opencli profile rename CONTEXT_ID cesar`, then set `opencli profile use cesar`. Use `--profile cesar` for commands that must fail rather than select another connected profile if Cesar is unavailable. The local zsh environment also sets `OPENCLI_PROFILE=cesar`: OpenCLI treats this as a required profile, while its saved default alone is a preference that can fall back to another connected profile.

The manager config accepts `profileExtensions`, with `cesar` and `tyson` arrays of absolute unpacked-extension paths. The owning profile host loads these through its original Chrome debugging pipe, using `Extensions.loadUnpacked` and the required extension-debugging flag. That flag is enabled only for hosts with configured extensions. Installed Chrome and its existing launch settings remain in use. Reinstallation retains the configured paths; keep the extension files at those stable paths.

OpenCLI controls its own adapter/browser tabs through `chrome.debugger`; those extension-owned attachments are outside the manager's JS-Reverse worker inventory. The two tools share site login state and browser effects. Keep separate working tabs and avoid operating both tools on the same tab at once.

Check account readiness with `opencli --profile cesar auth status --site notebooklm,gemini,reddit,twitter,jimeng --full`. A navigation error is not a signed-out result: inspect the live page, then run the affected site's `whoami` command. Complete any actual login, MFA, or consent in the same Cesar browser. Cookies remain in Chrome.

### Managed installation

Requirements: macOS 14+, Xcode command-line toolchain with Swift 6, system Google Chrome, and this checkout's Node dependencies. Build and test before installing:

```sh
npm ci
npm run build
JS_REVERSE_INTEGRATION=1 node --test build/tests/managed.test.js build/tests/managed.integration.test.js
python3 scripts/managed.py install --cesar /absolute/existing/cesar-root --tyson /absolute/existing/tyson-root
```

The installer requires two existing user data directories. It preserves their contents and the repository's Patchright launch flags, including real-keychain arguments needed by these same-machine profiles. It creates a versioned build under `~/.local/share/js-reverse-manager/releases/`, a private config at `~/.config/js-reverse-manager/config.json`, an app link at `~/Applications/JS-Reverse.app`, and four user LaunchAgents:

- `local.js-reverse.chrome-cesar`
- `local.js-reverse.chrome-tyson`
- `local.js-reverse.manager`
- `local.js-reverse.menu`

Build snapshots reference this checkout's `node_modules`; keep the checkout and dependencies installed. Reinstall after source changes to deploy a new snapshot. Reinstallation explicitly restarts managed jobs and disconnects their workers. Run it between browsing activities. Initial installation refuses a competing legacy Chrome owner; close only that dedicated browser before retrying.

In the canonical `agent-tool-routing` checkout, run `just doctor`, `just deploy --agent codex,pi --mode gui`, then `just smoke`. Deployment detects the manager config, registers the facade for each harness, and preserves unrelated MCP entries and settings. Reload the Pi extension or start a new Pi process; reconnect Codex's JS-Reverse MCP/start a fresh app process to load the changed command and schemas. An already-connected MCP process keeps its old tool catalog.

```sh
just status              # complete profile/instance/session tree as JSON
just menu                # launch the native menu extra
just disconnect INSTANCE_ID
just managed-stop        # stop all four managed jobs; persistent data stays
just managed-start       # restart installed jobs
```

The old `just cesar`, `just tyson` and global switching script refuse to switch while a manager config is installed. Both profiles are available concurrently.

## Verification and recovery

### Native Chrome downloads and local HTTP

Downloads follow each Chrome profile's **Settings → Downloads**, including the
folder, prompting, original filenames and Chrome's existing `(1)`, `(2)` collision
handling. They remain on disk when a worker disconnects. No agent download folder
is hard-coded. On this Mac both profiles currently resolve to `/Users/ielts/Downloads`.

`src/third_party/nativeChromeDownloads.ts` selects Patchright's internal
`internal-browser-default` mode before a persistent browser context is initialized,
on both host launch and worker CDP attachment. Patchright's public API exposes only
accept/deny; its normal default installs an `allowAndName` download delegate with a
temporary directory and UUID filenames. Resetting that delegate afterward with
`Browser.setDownloadBehavior(default)` crashed the existing Cesar profile on Chrome
153.0.8010.37. Leaving the native delegate in place passed actual duplicate-download
checks in Cesar and Tyson. Patchright is pinned to the already installed 1.58.2;
revalidate this small compatibility adapter and the browser integration test before
upgrading it. No installed dependency files are modified.

The macOS user's `com.google.Chrome` preferences contain the recommended policy:

```json
{"HttpAllowlist": ["[*.]mini", "[*.]lan", "[*.]gpu"]}
```

Both managed browsers recognize it as **Platform / Current user / Recommended / OK**
in `chrome://policy`. This macOS user setting also applies to other Google Chrome
profiles for the same user. It does not change explicit HTTPS URLs or HSTS. Existing
launch flags remain unchanged, including Patchright's pre-existing global
`HttpsUpgrades` disable flag; this change does not claim to restore global HTTPS
upgrade protection. The allowlist also applies to HTTPS-First warnings, independently
of that flag.

To inspect or restore the local policy (quote the entire property-list array):

```sh
defaults read com.google.Chrome HttpAllowlist
defaults write com.google.Chrome HttpAllowlist '("[*.]mini", "[*.]lan", "[*.]gpu")'
```

Reload `chrome://policy` and restart the managed browsers if the setting has not
appeared. The original key was absent; `defaults delete com.google.Chrome HttpAllowlist`
undoes this addition. Its before-state is saved in the manager's
`backups/chrome-settings-20260913T102219Z/HttpAllowlist-before.json`.

References: [Chrome's macOS policy setup](https://www.chromium.org/administrators/mac-quick-start/),
[HttpAllowlist definition](https://github.com/chromium/chromium/blob/main/components/policy/resources/templates/policy_definitions/Miscellaneous/HttpAllowlist.yaml),
and [Chrome 153's DevTools download delegate](https://github.com/chromium/chromium/blob/153.0.8010.37/content/browser/devtools/protocol/devtools_download_manager_delegate.cc).

### Runtime checks

`launchctl print gui/$(id -u)/local.js-reverse.chrome-cesar` shows the profile host job; repeat for the other labels. Logs are in `~/.local/share/js-reverse-manager/logs/`. Compare the actual Chrome command line's `--user-data-dir` against the private configuration. A menu heartbeat only proves the manager is reachable; a tool evaluation proves a worker reaches Chrome.

The integration test creates disposable headless user data directories and actually drives three MCP workers through two Chrome hosts. It verifies conversation tab selection, profile policy, OAuth binding retention, attachment inventory, detachment, revocation, explicit reconnect, and browser survival after all MCP clients close. This does not establish website-specific anti-bot behavior or verify any account subscription/login.

Manager restarts revoke existing in-memory registrations; workers need explicit new bindings. Browser crashes end that profile's connections, and launchd restarts its host. Manual Chrome Quit is also restarted while its job is loaded; use `managed-stop` for an intentional full stop.

Every installation saves prior config and plist files under `~/.local/share/js-reverse-manager/backups/`. Routing deployment separately saves its changed client configuration under `~/.config/agent-tool-routing/backups/`. To roll back, stop managed jobs, restore only those affected config/plist entries and the previous app link, then bootstrap the restored jobs. To return to legacy mode, stop the jobs, move the manager config aside, and redeploy the canonical routing configuration; its saved legacy profile options remain available. Never delete user data directories or locks to force startup.

## Protocol boundary

The gateway uses one upstream CDP WebSocket for each downstream worker connection; commands, responses and events retain their original wire contents. It stores only connection labels and target/session metadata in memory, strips credentials/query/fragment from displayed URLs, and never persists CDP bodies. A private loopback control token and separate instance tokens protect registration and attachment. Detach commands use negative IDs reserved from Patchright's positive request-ID sequence, and their replies are consumed by the manager.

The inventory covers **managed JS-Reverse connections**. Raw Chrome endpoints are loopback-only but remain reachable to other processes of the same user. A direct client bypassing the manager is not an identified conversation in this tree. This is lifecycle management, not an OS sandbox or a same-user security boundary.

Implementation was built against the installed Patchright 1.58.2, MCP SDK 1.29.0 and Chrome 153. Native UI uses Apple's [MenuBarExtra](https://developer.apple.com/documentation/swiftui/menubarextra); gateway upgrade handling follows the installed [ws documentation](https://github.com/websockets/ws#client-authentication). Context7 was unavailable during implementation, so the installed primary documentation was read directly.
