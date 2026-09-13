---
status: accepted
---

# Share persistent profile browsers through managed connections

Cesar and Tyson carry different signed-in identities, while Codex and Pi conversations need independent debugger and collector state. Run one persistent Chrome instance per identity under user launchd, give each conversation a separate JS-Reverse worker per profile, and bind each browsing activity using deterministic service policy plus the browse skill's purpose classification. Put a transparent CDP connection manager between workers and Chrome so a native menu bar extra can display the full profile → JS-Reverse instance → CDP session tree and revoke connections without closing either profile browser.

## Consequences

- A binding stays with its profile across redirects and OAuth; an explicit user choice overrides automatic selection when starting a new activity. There is no global active-profile switch in this workflow.
- Worker state is private to its conversation; tabs, cookies, and browser effects remain shared within a profile. Each worker starts with a new working tab, and deliberate existing-tab reuse is explicit.
- The MCP facade requires an explicit binding on browser operations. Isolation therefore does not depend on a harness promising one MCP transport per conversation.
- Manual instance disconnection revokes its capability. Reconnection is explicit, and Chrome survives worker or harness shutdown.
- The tree inventories all CDP sessions on managed JS-Reverse connections, including automation-library sessions. Unmanaged clients that bypass the manager cannot be given trustworthy conversation labels or controlled through this tree.
- Existing persistent directories and Chrome launch/keychain behavior are preserved. This decision does not provide paused-frame handoff between harnesses or isolation between two workers deliberately controlling the same target.
