# Managed browser verification

Verified locally on 2026-09-12 with macOS, Chrome 153.0.8010.37, Patchright 1.58.2, Node 26.7.0, MCP SDK 1.29.0 and Swift 6.3.3. The implementation extends checkout revision `cd6f5d0fa7ed0f9a6c0434f1c7131508e296620f`.

| Boundary                  | Evidence                                                                                                                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing behavior         | Full suite: 121 passed, zero failed; the optional Chrome integration test is skipped in the default run.                                                                                                                                                                                                 |
| Real browser concurrency  | The separately enabled integration test passed with two disposable Chrome profiles and three independent MCP workers. Two conversations shared one facade and retained distinct selected tabs.                                                                                                           |
| Profile policy            | Known-service rules, explicit choice, domain-boundary checks, unknown cloud-provider classification, Tyson default, and sticky learning-to-Google OAuth continuation passed.                                                                                                                             |
| Original tool behavior    | All 24 original tools retain their handlers, output schemas and original server instructions. The managed facade adds `select_browser` and requires a worker binding on forwarded calls.                                                                                                                 |
| Shared blank tabs         | The integration test verified `new_page` reuses only its worker's selected blank, preserving other workers' blank tabs. Legacy direct mode retains its previous behavior.                                                                                                                                |
| Session inventory         | Live existing profiles showed two Cesar workers with 16 CDP sessions each and one Tyson worker with 7, including background service-worker and nested browser/page attachments.                                                                                                                          |
| Native controls           | In the exact production `TreeView` hosted in a temporary native window, Detach changed 16 sessions to 15; Disconnect ended only that worker; Remove cleared its finished row. Other workers and Chrome remained running.                                                                                 |
| Native presentation limit | The UI automation provider cannot select menu-only LSUIElement apps. The production menu process was verified running and connected to the manager; its shared tree view was visually inspected and operated in `macos/PreviewHost.swift`. The menu popup itself was not directly clicked by automation. |
| Cleanup                   | Temporary verification tabs and worker records were removed; the temporary UI host exited. Existing profiles and unrelated tabs were preserved.                                                                                                                                                          |
| Reconnect                 | A tool retry after disconnection failed; explicit reconnect created a fresh worker. Closing all MCP clients left both profile hosts alive.                                                                                                                                                               |
| Launchd                   | Four jobs ran with the expected programs. Actual Chrome commands used the registered distinct user data directories and remote debugging. The upgrade path passed after waiting for asynchronous job/process termination.                                                                                |
| Harness deployment        | Codex and Pi configurations point to the installed managed build. Real catalog handshakes expose 25 tools. Existing MCP connections must reconnect to load a changed command/catalog.                                                                                                                    |
| Pi identity               | Adapter tests verified it supplies the actual Pi session-manager ID and updates it after a session switch. No model-provider configuration changed.                                                                                                                                                      |
| Routing maintenance       | 10 Python deployment tests, including all 18 platform/mode/agent fixtures, and 3 Node adapter/transport tests passed. Managed redeployment is idempotent and retains unrelated configuration.                                                                                                            |
| Static checks             | TypeScript build, ESLint/Prettier, generated-doc checks, 30 existing tool-routing cases, skill validation, and diff whitespace checks passed.                                                                                                                                                            |
| Dependencies              | Production audit passed the configured high-severity threshold. Existing moderate transitive findings in Hono and qs remain; unrelated dependencies were not upgraded. The new direct ws dependency is pinned to 8.21.3.                                                                                 |

The disposable headless test does not establish website-specific anti-bot behavior, login validity, subscription status, or execution isolation between workers deliberately controlling the same target. The gateway inventories managed JS-Reverse connections; raw CDP clients outside it have no conversation attribution in this tree.

See [operation and recovery](managed-browsers.md) and [the accepted ADR](adr/0001-shared-profile-browsers.md).

## Portable releases and OpenCLI — 2026-09-14

Local verification in this checkout on macOS:

- `npm run presubmit`: 124 tests passed, one opt-in browser test skipped;
  type/format checks, 24-tool documentation checks, 30 routing cases and package
  dry-run passed. Production audit reported no high/critical advisories; the two
  existing moderate advisories remain. OpenCLI's YAML dependency is locked to the
  compatible fixed 4.3.2 release.
- With `JS_REVERSE_INTEGRATION=1`, the Python deployment suite passed all 11 tests.
  It includes real Chrome cleanup after manager failure and abrupt supervisor
  death, rejection of a second supervisor, immutable-release/configuration checks,
  bridge checksums, and a macOS adapter fixture inspecting its generated plists.
  The launchd/signing commands in that adapter fixture are substituted; it does
  not replace the earlier native menu evidence.
- The separate real Chrome MCP integration passed with two disposable browser
  profiles, three workers, retained bindings, per-worker cleanup and native
  download directory/name/collision behavior.
- A fresh disposable release actually ran production `npm ci`, fetched and
  hash-verified the pinned Browser Bridge assets, and ran OpenCLI 1.8.7 from its
  own dependencies. No dependency directory points back into this checkout.
- The local wrapper's `doctor` reached the existing Cesar extension (1.0.24) and
  OpenCLI daemon (1.8.7). The bridge provisioner also verified and retained the
  existing extension directory. No new site authentication claim is inferred
  from this connectivity check.

The Windows, Linux and macOS headless Chrome/deployment jobs also passed in
[GitHub Actions](https://github.com/dual1208/js-reverse-mcp/actions/runs/34937357051).
That initial run exposed an unrelated full-suite dependency on this Mac's legacy
profile; CLI tests now create a disposable home and explicitly verify rejection
of a missing profile. Documentation and routing evaluation share one metadata
reader with its own disposable home. The entire presubmit also passed with an
empty caller home. No installation was attempted on an Arch workstation, and
no Wayland GUI was visually tested. The live personal launchd browsers were not
redeployed during this refactor.
