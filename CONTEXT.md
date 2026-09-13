# Browser Investigation

The vocabulary for using persistent browser identities from independent agent conversations and inspecting their browser connections.

## Language

### Browser identity and state

**Browser identity**:
A named collection of persistent browser state associated with a set of user activities and signed-in accounts. Cesar and Tyson are the two browser identities in this project.
_Avoid_: Account, session

**Cesar**:
The browser identity for OpenCLI-indexed services, social media, OpenRouter, Google services, and cloud or virtual-machine service providers.

**Tyson**:
The browser identity for learning, practice, and general browsing outside Cesar's activities.

**User data directory**:
The storage root for a set of Chrome browser state, containing one or more Chrome profiles and state shared between them.
_Avoid_: Profile directory when referring to the whole root

**Chrome profile**:
A collection of browser preferences and site state within a user data directory. A Chrome profile is distinct from a browser instance and from an individual website account.
_Avoid_: Browser instance, login session

**Browser instance**:
A running Chrome browser and its associated processes, using a particular user data directory.
_Avoid_: Profile, connection

**Application bundle**:
The code, resources, and application metadata that macOS treats as one application. Multiple browser instances can execute from the same application bundle.
_Avoid_: Browser instance, profile

**Process incarnation**:
One execution of a process from its creation until its exit. An operating-system process identifier can be reused by a later incarnation.
_Avoid_: PID when referring to a durable identity

**Process serial number**:
A macOS identifier for a registered application process. It is distinct from a browser target or CDP session identifier.
_Avoid_: CDP session, conversation

**Dock tile**:
The system presentation of a running application or a minimized window in the macOS Dock.
_Avoid_: Application bundle, browser profile

### Debugging protocol

**CDP endpoint**:
An address through which a client can discover or establish a Chrome DevTools Protocol connection to a browser.
_Avoid_: Debugger instance

**CDP connection**:
A client's transport connection carrying Chrome DevTools Protocol commands, responses, and events. One connection can carry multiple CDP sessions.
_Avoid_: CDP session when referring to the transport connection

**Target**:
A browser entity exposed for inspection through Chrome DevTools Protocol, such as a page, worker, or separately exposed frame. A target is distinct from the client attached to it.
_Avoid_: Connection, selected page when the entity is not necessarily a page

**CDP session**:
An attachment to a target, identified within the debugging protocol and used to address commands and events to that attachment.
_Avoid_: Conversation, MCP connection, login session

**Paused call frame**:
A debugger's representation of a function invocation in a suspended JavaScript execution, including its location and accessible scopes. Its identifier refers to that live pause, not to a saved execution.
_Avoid_: Browser frame, persistent session

### Agent access and routing

**Harness**:
The application that hosts an agent conversation and provides its tool access, such as Codex or Pi.
_Avoid_: Conversation, JS-Reverse instance

**Conversation**:
A user-visible task and its interaction history within a harness. Its identity is distinct from the identities of the tool processes and protocol connections it uses.
_Avoid_: Session without a qualifier

**JS-Reverse instance**:
One running JS-Reverse server with its own selected page, debugger records, and collected evidence.
_Avoid_: Chrome instance, CDP session

**MCP connection**:
A protocol connection between an MCP client and server for exchanging tool requests, results, and other MCP messages.
_Avoid_: CDP connection

**Browsing assignment**:
A bounded browser activity undertaken for a conversation, with an intended service or purpose. One conversation can contain assignments involving different browser identities.
_Avoid_: Entire conversation when only one browser activity is meant

**Profile binding**:
The association between a browsing assignment and the browser identity used for it.
_Avoid_: Global active profile

**Profile policy**:
The rules that associate a new browsing assignment with a browser identity according to service affinity, the user's purpose, and explicit identity preferences. An existing binding stays in effect while its assignment continues.
_Avoid_: Network proxy, global profile switcher

**Browser session handle**:
An opaque reference to the JS-Reverse worker serving a conversation through a particular browser identity. It keeps browser operations associated with their intended worker even when a harness shares its MCP connection.
_Avoid_: CDP session ID, website login token

**Connection manager**:
The authority for the inventory, ownership labels, and disconnection of managed browser connections.
_Avoid_: Debugger, profile router

**Managed connection**:
A browser connection whose lifecycle and owner are known to the connection manager.
_Avoid_: All browser connections when unmanaged clients may also exist

**Disconnect**:
The end of a client's connection to the browser. It is distinct from closing a target, stopping the browser, or deleting its persistent state.
_Avoid_: Close browser, delete profile

**Detach**:
The end of one CDP attachment to a target. Other attachments to the same target can remain active, and the target itself remains open.
_Avoid_: Disconnect instance, close tab
