# Porting agentsd to Windows

Analysis of [paultyng/agentsd](https://github.com/paultyng/agentsd) @ depth-1 clone,
July 2026. MIT licensed. ~1,200 lines of TypeScript, well-tested (vitest, 7 test
files), clean architecture.

**Verdict: the platform-specific surface is ~45 lines across 3 files.** Everything
else is portable Node. This is a much better starting point than writing from
scratch — the architecture is the one we independently arrived at, and it has
solved several race conditions we would have hit.

## What ports unchanged

| File | Notes |
|---|---|
| `src/session-manager.ts` | Registry, state, permission queue, pruning. Pure Node. One exception below (`process.kill`). |
| `src/state-machine.ts` | 5 states, pure logic. |
| `src/types.ts` | — |
| `src/util/svg.ts` | 16 lines. SVG data URI helpers. Renders at **144×144** (the @2x target, not 72). |
| `src/util/transcript.ts` | Reads transcript JSONL to backfill the model. `readFile` only. |
| `scripts/hooks.mjs` | **Fully cross-platform already** — `homedir()` + `join()`, no path assumptions. Installs/uninstalls all 16 hooks into `~/.claude/settings.json`. Lift verbatim. |
| `src/actions/*.ts` | All except `focus-button.ts`. |
| `src/hook-server.ts` | Except `lsof` (below). Already binds `127.0.0.1`. |

## The three things that don't port

### 1. `lsof` → PID resolution (hook-server.ts:174)

agentsd resolves the Claude Code PID **from the TCP connection's remote port**:

```ts
execFile("lsof", ["-i", `TCP:${remotePort}`, "-t", "-sTCP:ESTABLISHED"], ...)
```

The incoming socket's remote port is the Claude Code process's local port, so the
OS can name the process for you. Clever, and it means **HTTP hooks can identify
the calling process** — no command hook needed.

Windows equivalent — the remote port becomes the local port of the established
connection:

```powershell
Get-NetTCPConnection -LocalPort <remotePort> -State Established |
  Select-Object -ExpandProperty OwningProcess
```

Or parse `netstat -ano`, which is meaningfully faster than paying PowerShell's
startup cost.

**Change the call pattern, not just the command.** agentsd fires this on *every*
hook event ("updated on every hook event to stay fresh"). On macOS `lsof` is cheap;
on Windows, spawning a shell per `PreToolUse` will hurt. Resolve lazily — only when
`session.pid` is null — and let it go stale.

### 2. `process.kill(pid, "SIGINT")` → the dangerous one (session-manager.ts:220)

```ts
interruptActiveSession(): boolean {
  process.kill(session.pid, "SIGINT");
}
```

This *looks* cross-platform. It isn't. **On Windows, Node's `process.kill()` does
not deliver POSIX signals — the signal name is ignored and the target is terminated
unconditionally**, like SIGKILL. Porting this verbatim doesn't interrupt the turn,
it kills Claude Code and loses the session.

This is the single most dangerous line to copy.

Options, worst to best:

- **Don't ship Stop.** It's one key. Ctrl+C in the terminal already works and your
  hands are right there.
- **`windows-kill`** — I believe there's an npm package/utility that sends a real
  `CTRL_C_EVENT` to a PID on Windows. Verify it still exists and is maintained
  before depending on it.
- **Native `GenerateConsoleCtrlEvent(CTRL_C_EVENT, pid)`** — the correct answer,
  and fiddly: it requires `AttachConsole(pid)`, it affects every process sharing
  that console, and you must `SetConsoleCtrlHandler(NULL, TRUE)` first or you kill
  your own plugin.

Recommendation: skip Stop in v1. Revisit only if it turns out to matter.

### 3. `src/util/applescript.ts` → focus (41 lines, one consumer)

The entire file is three functions wrapping `osascript`. Only `focus-button.ts`
imports it. `sendInterruptToGhostty` appears to be dead code — `stop-button.ts`
uses `interruptActiveSession()` / `process.kill` instead.

Note what agentsd actually does here: it activates **the application by name**
("Ghostty", falling back to "Claude"), not the specific session's window. It punts.
Its own comment admits it: *"best-effort approach — we don't have PID access from
hook payloads"* — which is stale, since `hook-server.ts` does resolve the PID.

The Windows version has the same problem and can punt the same way. Activating your
terminal by name is a `Get-Process` + `SetForegroundWindow` (user32.dll via
`Add-Type`) — and **ono-sendai already has this code**; lift it.

Doing it *properly* (focus the specific window for a given session) is harder on
Windows than macOS: Claude Code is a console process with no `MainWindowHandle` of
its own, so you'd walk up to the hosting `WindowsTerminal.exe` or resolve the
console window. Not worth it for v1.

### 4. `manifest.json` — one line

```json
"OS": [ { "Platform": "mac", "MinimumVersion": "13" } ]
```

That's the only thing gating install. Add `{ "Platform": "windows",
"MinimumVersion": "10" }`.

**Also note:** agentsd is *not* encoder-dependent. `session-dial` is a separate
action with `"Controllers": ["Encoder"]`; every other action is `["Keypad"]`. On an
MK.2 you simply never place the dial action. Unlike AgentDeck, nothing here assumes
a Stream Deck+.

## Corrections to PLAN.md

Reading the source proved two things in our plan wrong.

### always-allow does NOT write settings.json

It's done entirely in the hook response, via `updatedPermissions`:

```ts
{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: {
    behavior: "allow",
    updatedPermissions: [{
      type: "addRules",
      rules: [{ toolName: toolName ?? "*", ruleContent: "*" }],
      behavior: "allow",
      destination: "session",
    }],
}}}
```

`destination: "session"` — scoped to the session, gone when it ends, no config
mutation at all. Much cleaner and much safer than the plan assumed. It can move
earlier than Stage 4.

### The PermissionRequest response shape is not the documented PreToolUse shape

Docs show PreToolUse using `permissionDecision` / `permissionDecisionReason`.
agentsd uses a different shape for PermissionRequest:

```ts
{ hookSpecificOutput: { hookEventName: "PermissionRequest",
    decision: { behavior: "allow" | "deny", message: "..." } } }
```

Confirm against a live session in Stage 0.5 — one of these may be stale.

### Hook timeout is per-hook config, not a fixed platform value

`scripts/hooks.mjs` sets `timeout: 5` on everything and `timeout: 120` on
PermissionRequest. So "what is the hook timeout" isn't a question — it's a number
you choose. 120s matches agentsd's `PERMISSION_TIMEOUT_MS`; the two must agree or
Claude Code gives up while the deck is still holding the connection.

## Gotchas worth stealing

Things agentsd hit that we would have hit later and more painfully.

- **Parallel tool events kick a session out of AWAITING_PERMISSION and auto-deny.**
  There's an explicit guard (session-manager.ts:132) suppressing transitions away
  from AWAITING_PERMISSION while a plugin-held permission is pending. Non-obvious
  race; would have been a miserable bug.
- **The user might approve in the terminal instead of on the deck.** On
  transitioning away from AWAITING_PERMISSION via any non-resolution path, clear the
  stale pending permission and its timer. Dual input surfaces need this.
- **`server.close()` hangs on held-open connections.** Our whole design *guarantees*
  long-lived sockets — that's what PermissionRequest is. agentsd tracks every socket
  and destroys them on shutdown. Skip this and the plugin won't exit cleanly.
- **Prune only IDLE/DISCONNECTED, never PROCESSING.** A session working for 10
  minutes with no hook events must not be reaped. `STALE_PRUNE_STATES` gets this
  right.
- **Auto-created sessions start IDLE, not DISCONNECTED**, so subsequent tool events
  transition normally rather than being rejected by state guards.
- **Explicit deny on timeout, not `{}`.** An empty body is ambiguous.
- **Body size cap** (1MB) and `maxConnections = 100`.

## What agentsd does NOT have

- **No auth on the listener.** It relies on localhost binding alone. A web page you
  visit can POST to `127.0.0.1:9200` and approve a pending tool call. Our bearer
  token via `headers` + `allowedEnvVars` is a real improvement over the reference —
  keep it.
- **No profile switching.** No `Profiles` array in the manifest. The front-page
  status key + `switchToProfile` design is ours to build.
- **No pulse/animation.** Static `setImage` per state.
- **No pinned slots.** `activeIndex` + cycling, not cwd-pinned keys.
- **No effort key.**

## Recommended approach

Fork rather than reimplement. The delta to a working Windows v1:

1. `manifest.json` — add the Windows OS entry
2. `hook-server.ts` — swap `lsof` for `netstat -ano`, make PID resolution lazy
3. `stop-button.ts` — remove, or gate behind a real CTRL_C implementation
4. `focus-button.ts` — replace applescript with the ono-sendai window code
5. Add the bearer token to `hooks.mjs` + `hook-server.ts`

That's Stages 1–3 of PLAN.md largely done, by someone who already found the races.
Stage 0 (install claude-deck, decide whether you want this at all) still applies —
and honestly, agentsd with the OS field flipped might be the fastest way to run
Stage 0 properly, since claude-deck can't even see the permission state.
