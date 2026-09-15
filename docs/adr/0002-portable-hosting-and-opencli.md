---
status: accepted
---

# Share deployment and browser ownership across desktop hosts

Keep release preparation, profile validation, browser service ownership, and
OpenCLI provisioning independent of the desktop service manager. A portable
foreground supervisor and the macOS launchd installer consume the same release
and configuration; launchd, signing, and the Swift menu remain in `macos/`.
This preserves the existing reverse-engineering engine while making Windows and
Wayland usable without emulating a macOS desktop or requiring Unix symlinks.

OpenCLI is a pinned dependency of this repository. Its Browser Bridge extension
shares Cesar's browser identity through OpenCLI's own daemon; it does not become
a JS-Reverse worker. Pin the extension's upstream revision and file hashes,
preserve an existing installation path to retain its identity, and always request
the explicit Cesar alias when invoking OpenCLI.

## Consequences

- Releases contain their own production dependencies. Rebuilding or changing this
  checkout cannot change the code in an installed release.
- The portable supervisor owns its three child services and stops them gracefully.
  It exits if a service fails; an outer desktop service manager may restart it.
  macOS continues to supervise the services independently with launchd.
- Windows and Wayland share the connection manager, policy, facade, workers,
  profile hosts, and command-line inventory. The native menu remains macOS-only.
- OpenCLI's extension attachments remain outside the managed JS-Reverse session
  tree. A healthy extension connection does not prove a website is signed in.
- Existing browser directories and credentials stay on their original machine.
  Deployment neither creates empty replacement identities nor copies passwords
  between operating systems.
