# yolodeck

A Stream Deck control surface for [Claude Code](https://claude.com/claude-code) sessions, for **Windows**.

Every running session gets a physical key, colored by state. When Claude needs permission, the key turns gold and shows you the command — you approve or deny with your thumb instead of alt-tabbing to find which of five terminals is waiting.

Everyone calls `--dangerously-skip-permissions` "YOLO mode." 

## Credit

**yolodeck is derived from [agentsd](https://github.com/paultyng/agentsd) by Paul Tyng (MIT).** This is not a light inspiration — the hook server, session manager, state machine, and most actions started as his code, and its git history is preserved in this repo. agentsd is macOS-only; yolodeck ports it to Windows and has since diverged well past a portable delta (pinned session slots, profile switching, the usage key, per-key custom labels, and more have no agentsd equivalent).

If you're on a Mac, **use agentsd** — it's the original and it's better maintained.

## How it works

Claude Code's hooks POST lifecycle events to a listener that lives inside the plugin process. The plugin never talks to Anthropic, holds no API keys, and never initiates — it answers questions it's asked.

```
Claude Code session  --HTTP POST-->  yolodeck plugin  -->  Stream Deck app
  (hooks in                          (listener on            (WebSocket,
   settings.json)   <--JSON body--    127.0.0.1:9200)         setImage)
                     allow/deny
```

The key mechanism: a `PermissionRequest` hook **holds its HTTP response open** (up to 120s). Your button press *is* the response. No keystroke injection, no window focus games — measured at 11ms from request to resolution, with no dialog shown.

There is no separate daemon and nothing to install as a service. The Stream Deck app launches and supervises the plugin, and supplies the Node runtime.

## Requirements

- **Windows 10+**
- **Stream Deck app 6.6+** and a Stream Deck device. Built for a 15-key MK.2; no dials required.
- **Claude Code 2.1.80+** (earlier versions lack `rate_limits` in the statusLine JSON)
- **Node.js 24+** — for development only. Running the plugin doesn't need Node installed.

## Install

```sh
git clone https://github.com/cruftbox/yolodeck.git && cd yolodeck
npm install
npm install -g @elgato/cli   # one-time; provides the `streamdeck` CLI

# Generate a shared secret BEFORE installing hooks (see Security below)
setx YOLODECK_TOKEN "..."    # 32 random bytes, hex

npm run build
npm run link                 # register the plugin with Stream Deck
npm run hooks:install        # add HTTP hooks to ~/.claude/settings.json
```

Restart the Stream Deck app after linking. Actions appear under "yolodeck".

### Uninstall

```sh
npm run hooks:uninstall
npm run unlink
```

`hooks:uninstall` removes only yolodeck's entries, matched by URL prefix — anything else in your `settings.json` is left alone.

## Security

**The plugin needs no secrets, but it holds something more dangerous than an API key: an endpoint that approves arbitrary command execution.** An API key spends money; this runs code on your machine. Two things follow.

**1. The listener binds to `127.0.0.1` explicitly.** Node's `server.listen(9200)` binds *every* interface — on a home network that would expose the approve endpoint to every other device on the LAN.

**2. Set `YOLODECK_TOKEN`.** A web page you visit can POST to `127.0.0.1:9200` from your browser. Without a token, a malicious page could approve whatever's pending. With one it can't — browsers cannot set a custom `Authorization` header cross-origin without a CORS preflight, which the plugin never answers.

`hooks:install` wires it up via Claude Code's `headers` + `allowedEnvVars`, so the secret lives in a user environment variable rather than plaintext in `settings.json`:

```json
{
  "type": "http",
  "url": "http://127.0.0.1:9200/hooks/PermissionRequest",
  "timeout": 120,
  "headers": { "Authorization": "Bearer $YOLODECK_TOKEN" },
  "allowedEnvVars": ["YOLODECK_TOKEN"]
}
```

If the variable is unset the plugin runs open and warns. That's upstream's behaviour; it isn't a good default.

**Closing the deck can't hang Claude.** HTTP hooks fail open by design — connection failure, timeout, and non-2xx are all non-blocking, and Claude falls through to its normal terminal prompt. The corollary: you *cannot* fail closed. To deny anything, the endpoint must return 2xx with a decision body.

## Actions

| Action | Description |
|---|---|
| **Session** | One key per session (name from `customTitle`, falling back to `cwd`), color-coded by state. Press to target it for approve/deny and raise its window. |
| **Status** | The heartbeat — current state, tool name, active work count. Breathes while working, pulses while awaiting you. |
| **Model** | The active session's model (e.g. "Opus 4.8"), read from the transcript. |
| **Mode** | Permission mode — see below. Display-only; the plugin can't change Claude's mode. |
| **Approve** | Approve the pending permission. Lit + pulsing when live, dim otherwise. |
| **Always Allow** | Approve *and* stop asking for this for the rest of the session. See below. |
| **Deny** | Deny the pending permission. Lit + pulsing when live, dim otherwise. |
| **Focus** | Bring the active session's window forward, resolved by PID. |
| **Usage** | Rate-limit remaining. **Terminal sessions only** — the desktop app doesn't run the statusLine, so this reads "no data" there. |

### Mode key: what each permission mode means

Claude Code has six permission modes. The mode key shows whichever one the active session is in, using the same labels the app itself uses, so it's recognizable regardless of which surface (CLI, desktop app) set it. Colored **red** when Claude won't stop to ask before acting; **purple** when it still will.

| Label on the key | Mode value | What runs without asking |
|---|---|---|
| Manual | `default` | Reads only — every edit and command prompts |
| Accept / Edits | `acceptEdits` | Reads, plus file edits and common filesystem commands (`mkdir`, `mv`, `cp`, `rm`, `sed`) inside the working directory. Everything else, and anything outside that directory, still prompts |
| Plan | `plan` | Reads only — Claude researches and proposes a plan without editing |
| Auto | `auto` | **Red.** Nearly everything, screened in the background by a separate classifier model that blocks risky actions (`curl \| bash`, force pushes, secret exfiltration, production deploys, etc.) |
| Don't / Ask | `dontAsk` | **Red.** Nothing except what's pre-approved by `permissions.allow` rules or a hook — everything else is auto-*denied*, not prompted. For locked-down CI, not interactive use |
| Bypass / Perms | `bypassPermissions` | **Red.** Everything, including writes to protected paths like `.git` and `.claude`. No safety checks at all. Anthropic's own docs: only use this in an isolated container/VM with no internet access |

`acceptEdits` is likely what you're in day to day — edits go through silently, everything else (network calls, git pushes, arbitrary bash) still asks. The mode is set in the CLI (`Shift+Tab`) or the desktop app's mode selector, never by yolodeck.

### Always Allow is narrower here than upstream

`PermissionRequest` payloads include `permission_suggestions` — a rule Claude Code has already scoped to the actual request. Reading `C:\Windows\System32\drivers\etc\hosts` suggests `//c/Windows/System32/drivers/etc/**`; a file one level up suggests `//c/Windows/System32/**`.

agentsd ignores this and sends `{ toolName, ruleContent: "*" }` — approve one read of System32 and you've allowed `Read` **everywhere** for the session. yolodeck echoes the suggestion back instead, granting exactly what was asked for and nothing more. The blanket rule survives only as a fallback for payloads with no suggestions.

## Session states

| State | Color | Motion | Meaning |
|---|---|---|---|
| `IDLE` | Green | Steady | Connected, waiting for input |
| `PROCESSING` | Clay orange | Breathes | Claude is working |
| `AWAITING_PERMISSION` | Amber | Pulses | Approve or deny from the deck |
| `AWAITING_ELICITATION` | Purple | Pulses | Claude is asking a question |
| `DISCONNECTED` | Dark gray | Steady | No active session |

## Key behaviours

- **Sessions announce themselves.** Hooks live in `~/.claude/settings.json` (user-level), so every session on the machine reports in. There is no discovery — the first event *is* the registration.
- **Registration is lazy, on any event.** Not just `SessionStart`. If the Stream Deck app starts after your terminals, those sessions would otherwise be invisible forever despite firing `PreToolUse` constantly.
- **Stale pruning.** `SessionEnd` fires on a clean exit but not a hard kill. A session with a resolved PID is pruned the moment that process actually dies (checked every 30s), no matter how long it's sat idle. Only sessions whose PID hasn't resolved yet fall back to a 10-minute idle timeout, and only from `IDLE`/`DISCONNECTED`, never `PROCESSING`, so a long-running agent isn't reaped.
- **Permission queue.** Several sessions can be pending at once; they foreground in arrival order and resolving one advances to the next.
- **Permission timeout.** 120s, then an explicit deny. The hook config's `timeout` must match, or Claude gives up while the deck is still holding the connection.
- **Terminal approvals are handled.** If you approve in the terminal instead of on the deck, the stale pending permission and its timer are cleared.

## Windows port notes

The platform-specific surface of agentsd was about 45 lines. See [PORTING.md](PORTING.md) for the full analysis. In short:

- **`lsof` → `netstat -ano`** for resolving the Claude Code PID from the incoming socket's remote port. Also made lazy — upstream re-resolves on every hook event, which is fine for `lsof` on macOS and not fine for spawning a process on Windows.
- **`process.kill(pid, "SIGINT")` is not ported.** It looks cross-platform and isn't: on Windows, Node ignores the signal and terminates the target unconditionally. Porting it verbatim would kill Claude Code rather than interrupt the turn. The **Stop** action is removed as a result — Ctrl+C in the terminal already works.
- **AppleScript → PowerShell + user32.** Upstream activated a terminal by name and never used the PID it had. We walk up the parent process chain to find the window actually hosting the session, since Claude Code is a console process with no window of its own.
- **Session Dial removed.** Encoder action; this targets a 15-key MK.2.

## Development

```sh
npm run watch        # rebuild on change
npm run dev          # Stream Deck dev mode
npm test             # vitest
npm run typecheck
npm run debug:hooks  # interactive hook event probe
npm run profile:build     # regenerate the bundled .streamDeckProfile
npm run statusline:install / :uninstall
```

### Reloading the plugin

**`streamdeck restart` and `streamdeck stop` report success and do nothing.** Both
print a green tick while the plugin process keeps running with the old bundle — check
the pid and start time and you'll see it never changed. Kill the process instead; the
Stream Deck app supervises the plugin and respawns it with the current build:

```powershell
Get-NetTCPConnection -LocalPort 9200 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `YOLODECK_TOKEN` | unset | Shared secret required in the `Authorization` header. **Set this.** |
| `YOLODECK_DEBUG` | unset | When `1`, exposes `GET /debug/sessions` with a JSON snapshot of tracked sessions. |

## License

MIT. Copyright (c) 2025 Paul Tyng, copyright (c) 2026 Michael Pusateri — see [LICENSE](LICENSE).

## Acknowledgments

- **[agentsd](https://github.com/paultyng/agentsd)** by Paul Tyng — the foundation this is built on.
