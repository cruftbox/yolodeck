# yolodeck

A Stream Deck control surface for Claude Code sessions.

Everyone calls `--dangerously-skip-permissions` "YOLO mode." yolodeck is the
anti-YOLO: approving gets cheap enough that you stop wanting to skip it.

## What it does

Puts every running Claude Code session on a physical key, colored by state, and
turns permission requests into a thumb press instead of an alt-tab. Inspired by
Work Louder's Codex Micro, but built on Claude Code's hook system rather than a
proprietary integration.

## Hardware and platform

- Elgato Stream Deck MK.2 — 15 keys (5x3), no dials, 72x72px LCD per key
- Windows 11
- Claude Code, running locally (CLI, desktop app, or IDE extension — the plugin
  can't tell them apart and doesn't need to)

Out of scope: voice/push-to-talk, Stream Deck+ encoders, Codex CLI (its hook
support exists but AgentDeck drives it via PTY parsing, which is fragile),
cloud-run Claude Code (no local process, so no local hooks).

## Architecture

One-way. Claude Code POSTs; the plugin answers. The plugin never initiates,
never talks to Anthropic, holds no API keys.

```
Claude Code session  --HTTP POST-->  yolodeck plugin  -->  Stream Deck app
  (hooks in                          (listener on            (WebSocket,
   settings.json)   <--JSON body--    127.0.0.1:9200)         setImage)
                     allow/deny

Claude Code session  --stdin JSON--> passthrough script --POST--> same listener
  (statusLine in                     (prints the status line
   settings.json)                     through, forwards the JSON)
```

**Two input channels, not one.** Hooks carry *events* (state transitions,
permission requests). The statusLine carries *metrics* (rate limits, context
window, live effort level) that hooks do not include. Different settings key,
different mechanism, and statusLine is `type: "command"` only — no `http` type —
so it needs a small passthrough script.

The listener lives *inside* the plugin process. The Stream Deck app launches and
supervises it; there is no separate daemon and nothing to install as a service.
This is agentsd's design. AgentDeck's separate daemon (port 9120) exists because
it feeds 16 surfaces — we have one deck on one PC and don't need it.

Runtime: Node, declared via `Nodejs.Version` in the manifest. The Stream Deck app
supplies it. Node 24+ needed only for development.

## Key layout

```
[ sess 1 ][ sess 2 ][ sess 3 ][ sess 4 ][ sess 5 ]
[ pending][ approve][  deny  ][ always ][  stop* ]
[ usage  ][ effort ][ preset*][ focus* ][  back  ]
```

`*` = requires keystroke injection / window handling. Everything else is
hook-only. Rows 1 and 2 are the product; row 3 is garnish.

State colors: gray idle · blue working · gold needs-input · green done · red error

## Actions

| Action | Tier | Notes |
|---|---|---|
| `session` | hook | Renders `basename(cwd)` + state + current tool. Keyed by `session_id`. Press = target it. |
| `pending` | hook | Readout only. Tool name + truncated input. Dark when nothing pending. |
| `approve` / `deny` | hook | Resolves the held-open `PermissionRequest` with `permissionDecision`. |
| `always-allow` | hook | Returns `decision.updatedPermissions` with `destination: "session"` in the hook response. No config mutation — scoped to the session, gone when it ends. See PORTING.md. |
| `usage` | statusLine | `100 - rate_limits.five_hour.used_percentage` big, `resets_at` countdown small. Press toggles to `seven_day`. Color by remaining: green >50, amber <25, red <10. Account-wide, not per-session. |
| `effort` | statusLine + hook | *Displays* `effort.level` — the statusLine reports the live value including mid-session `/effort` changes, so the key shows truth rather than its own guess. *Setting* it without injection still goes through `UserPromptSubmit` prompt modification. |
| `stop` | inject | Ctrl+C to the session's terminal. |
| `focus` | inject | Window activation. ono-sendai already has this code. |
| `preset` | inject | Configurable text to the focused terminal. |
| `back` | none | Built-in Switch Profile action, not ours. |

## Session identity

Sessions are not discovered — they announce themselves. Hooks live in
`~/.claude/settings.json` (user-level), so every session on the machine fires
them. First event from an unknown `session_id` registers it.

Rules that matter:

- **Upsert on *any* event, not `SessionStart`.** If the Stream Deck app starts
  after your terminals, or the plugin restarts, you never saw SessionStart — but
  that session is still firing `PreToolUse` every few seconds. Register lazily or
  those sessions are invisible forever.
- **Staleness timeout.** `SessionEnd` fires on clean exit but not on a hard kill.
  No events for N minutes → gray out, free the slot.
- **Roll up subagents.** Payloads carry `agent_id` / `agent_type` when the event
  comes from inside a subagent. Slot by parent session and show a count, or one
  `/code-review` fills the deck with Explore agents.
- **Slot assignment: pinned + overflow.** ✅ **DONE 2026-07-15.** A key configured
  with `C:\Code\orbis` claims any session whose `cwd` matches, so orbis is always the
  same key. Unpinned keys are a first-come pool ordered by deck position (coordinates
  are the only stable ordering available — otherwise two overflow keys both claim
  session #1). `cwd` is stable and human-meaningful; `session_id` is neither.
  Configured via a self-contained property inspector at `ui/session.html`, which lists
  live session directories so pinning is a click rather than typing a path.

  This required abandoning upstream's model: agentsd has one "active session" and every
  Session key renders it, so five keys were five identical keys and you pressed to
  cycle. Each key now resolves its own session, and pressing one *targets* it for
  approve/deny. The targeted key carries a white ring — with one key that was implicit,
  with five "which agent am I approving?" is a real question.

## Profile switching ✅ DONE 2026-07-15

Constraint from the SDK docs: *"Plugins do not have access to user-defined
profiles, and therefore cannot switch to them. Plugins can only switch to
profiles distributed with the plugin."*

So:

- **Front page** (existing, hand-made): one `status` key. Renders aggregate state
  — gray idle, gold + count when anything needs input. Press → plugin calls
  `switchToProfile(deviceId, "yolodeck")` on its own bundled profile.
- **yolodeck profile** (bundled, exported `.streamDeckProfile`, listed in the
  manifest `Profiles` array): the 15-key layout above, plus a built-in Switch
  Profile action pointing back. The *built-in* action has no restriction — only
  the plugin API does.

Cost to the existing layout: exactly one key.

**Built 2026-07-15.** The `overview` action is the front-page key: dim when idle,
blue with a working count, gold when something waits — naming the project when only
one does, since "orbis is waiting" is actionable in a way "1 waiting" isn't.

The bundled profile is **generated**, not hand-exported (`npm run profile:build`).
Elgato's documented workflow is to build a layout in the app and export it, which
produces an opaque blob nobody can review or diff and has to be re-exported by hand
on every change. `.streamDeckProfile` turns out to be a plain ZIP of JSON:

```
<UUID>.sdProfile/manifest.json            { Device:{Model,UUID}, Name, Pages, Version }
<UUID>.sdProfile/Profiles/<PAGE>/manifest.json
                                          { Controllers:[{ Actions:{ "col,row": {...} } }] }
```

Format learned from the profiles in `Program Files\Elgato\StreamDeck\DefaultProfiles`
and the user's own `ProfilesV3`. Two things that only reading real files would tell you:

- **A profile is bound to a device model.** This deck reports `20GAA9902`; Elgato
  ships one default profile per model for the same reason.
- **`Switch Profile` with an empty `ProfileUUID` means "the default profile".** So the
  return trip needs no configuration, and the bundled profile can ship it working.

Do **not** use PowerShell's `Compress-Archive` to build it — it writes backslashes as
path separators, which the ZIP spec forbids. Use .NET `ZipArchive` with explicit entry
names.

Do **not** auto-switch profiles on needs-input. It runs into the no-return-path
constraint and hijacking the deck mid-task gets old immediately. Let the status
key nag instead.

## Animation

`setImage` accepts SVG (recommended), PNG, JPEG, WebP — and explicitly **does not
support animated GIF**. Animation = push frames on a timer. Since SVG is
supported, a frame is a small string with one opacity value changed; no image
encoding per frame.

Design rule: **pulse to summon, solid to accept.**

- Pulse the `session` key and the front-page `status` key — those answer "who
  needs me?"
- `approve` / `deny` go from dark/inert to **solid**. Never pulse a button at the
  moment a thumb is reaching for it; you want it stable and certain under the
  finger. The dark→lit transition is already a strong signal.
- Slow breathe, not blink. Needs-input is a *patient* state. Fast blinking reads
  as an alarm and gets disabled within a week. If you want urgency, let the
  breathe accelerate with time-waiting — the thing that escalates is the waiting,
  not the asking.

No documented rate limits for `setImage`. One key breathing at 2–4fps won't find
the ceiling.

## Security

The plugin needs no secrets but holds something worse than an API key: an
endpoint that approves arbitrary command execution. An API key spends money; this
runs code.

1. **Bind explicitly.** `server.listen(9200, '127.0.0.1')`. Node's
   `server.listen(9200)` binds to *all interfaces* — on this LAN that means the
   NAS, the Pi, and every ESP32 panel could approve commands in your sessions.
   Single most important line in the project.
2. **Bearer token.** A web page you visit can POST to `127.0.0.1:9200`. Without a
   token a malicious page could approve whatever's pending. With one it can't —
   browsers can't send custom headers cross-origin without a CORS preflight,
   which we don't answer.

```json
{
  "type": "http",
  "url": "http://127.0.0.1:9200/hooks/PreToolUse",
  "headers": { "Authorization": "Bearer $YOLODECK_TOKEN" },
  "allowedEnvVars": ["YOLODECK_TOKEN"]
}
```

`allowedEnvVars` is required for interpolation to happen at all, and keeps the
secret in a Windows user env var rather than plaintext in settings.json.

**Fail-open is free and mandatory.** HTTP hooks fail open by design — connection
failure, timeout, and non-2xx are all non-blocking; execution continues and falls
through to the normal terminal prompt. Deck closed ≠ Claude hangs. The corollary:
you *cannot* fail closed. To deny anything the endpoint must return 2xx with a
decision body. There is no config where an unreachable deck means "block
everything."

## Stages

Each stage ships something usable. Risk is front-loaded; injection is last and
may never happen.

### Stage 0 — Validate, don't build

- Install [claude-deck](https://github.com/etechlead/claude-deck) (`setup.bat`,
  ~15 min). Use it for a day. Does status-on-desk actually change how you work?
  If it doesn't, stop here and save yourself a weekend.
- Its limitations are the spec for the real thing. Known bug worth feeling
  firsthand: it shows **completed** when Claude is actually blocked on a
  permission prompt — because it only watches `UserPromptSubmit` / `Stop` /
  `Notification` and never `PermissionRequest`. That state is the entire point of
  yolodeck.

### Stage 0.5 — Spike the unknowns ✅ DONE 2026-07-15

Run with `spike/server.mjs` + `spike/hooks.mjs`. **Every question answered; the
premise holds.** Results:

**Do the permission prompts Michael actually gets fire `PermissionRequest`?**
**Yes.** Reading outside `permissions.additionalDirectories` fires it reliably.
This was the make-or-break question and Stage 3 is alive.

**Does returning a decision suppress the TUI dialog?** **Yes**, and it's instant:

```
04:04:10.231  PreToolUse
04:04:10.236  PermissionRequest
04:04:10.236  <<< auto-allow returned
04:04:10.242  PostToolUse          ← 11ms end to end, no dialog, no click
```

**Which response shape?** **agentsd's is correct.** This works:

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" } } }
```

The docs' `permissionDecision` / `permissionDecisionReason` shape is PreToolUse's,
not PermissionRequest's. Don't mix them up.

**Are hooks snapshot at session start?** **No — they load live.** A session that
was already running picked up newly-installed hooks on its very next tool call.
Suspecting otherwise was wrong; no restart needed after editing `settings.json`.

**Event order:** `PreToolUse` → `PermissionRequest` → (decision) → `PostToolUse`.

#### Bonus finding: `permission_suggestions`

The `PermissionRequest` payload includes a ready-made rule, scoped to the actual
request:

```json
"permission_suggestions": [{
  "type": "addRules",
  "rules": [{ "toolName": "Read", "ruleContent": "//c/Windows/System32/**" }],
  "behavior": "allow",
  "destination": "session"
}]
```

Claude Code computes the scope per request — reading `drivers/etc/hosts` suggested
`//c/Windows/System32/drivers/etc/**`, while a file one level up suggested
`//c/Windows/System32/**`.

**Our `always-allow` should echo `permission_suggestions[0]` back rather than
hand-rolling a rule.** agentsd builds `{ toolName, ruleContent: "*" }`, which allows
*all* Read for the session — far broader than the request warranted. Echoing the
suggestion makes our always-allow strictly safer than the code we forked. Verified
working: approving the `hosts` read added a session rule that silently covered a
later `networks` read in the same directory.

#### Bonus finding: the mode is not what settings.json says

`settings.json` declares `defaultMode: "bypassPermissions"`, but every live hook
payload reports `"permission_mode": "acceptEdits"`. That mismatch is the likely
explanation for the long-standing "bypassPermissions doesn't suppress prompts on
Windows desktop" confusion — the session isn't in bypassPermissions at all. In
`acceptEdits`, edits are auto-accepted and everything else still asks, which is
exactly the observed behaviour (prompts on Read/WebFetch, none on Edit).

Root cause of the mismatch is **not yet established** — worth a separate look.

#### Still open

- Is `session_id` stable across `--resume`? (Not blocking; affects slot stickiness.)

### Stage 1 — Listener only ✅ DONE 2026-07-15

Standalone Node process. No Stream Deck code at all.

- HTTP server, 127.0.0.1, bearer token, fail-open verified
- Session registry: upsert-on-any-event, staleness timeout, subagent rollup
- Prints a live session table to the console

Fully testable without hardware. If the model is wrong, it's wrong here, cheaply.

### Stage 2 — Read-only deck ✅ DONE 2026-07-15

- Scaffold plugin (`@elgato/streamdeck` CLI), fold Stage 1's listener in
- `session` action: render name + state + tool
- Pinned + overflow slot assignment
- Bundle the profile, add the front-page `status` key + `switchToProfile`

**Ships:** agent status on your desk. Watching only, no interaction.

### Stage 3 — The payoff ✅ DONE 2026-07-15

- `PermissionRequest` held open, resolved by button press
- `pending` readout key
- `approve` / `deny`, dark and inert when nothing is pending

**Ships:** the actual product. Everything after this is optional.

**Verified on hardware 2026-07-15:**

```
04:48:47.975  PermissionRequest: holding response ... tool=Read
04:48:47.975  → AWAITING_PERMISSION                    (deck goes gold)
04:48:50.813  Resolved from Stream Deck: APPROVE session=809ef0af tool=Read
04:48:50.821  PostToolUse  prev=PROCESSING  hasPending=false
```

8ms from button press to Claude proceeding. No dialog shown. The 2.8s before it is
human reaction time — now the only latency in the system.

Stages 1–3 arrived together by forking agentsd rather than building up, as PORTING.md
recommended. Reaching them took ~5 changes to working code instead of three weekends.

### Stage 4 — Polish

- ✅ **Key rendering rebuilt 2026-07-15.** The plugin was running two rendering systems
  at once: some actions drew text into the SVG, others called `setTitle()` and relied on
  Stream Deck's overlay with `TitleAlignment: "bottom"`. The overlay draws *on top of*
  the image, so a centred glyph and a bottom title collided — "Approve" sat across the
  tick — and long titles clipped, with "Permission?" rendering as "rmission" because the
  overlay never shrinks text. Everything now goes through `keyImage()` in util/svg.ts:
  glyph scaled and lifted, text below it, font auto-fitted to the key width.
  `ShowTitle: false` on every manifest state; nothing calls `setTitle()`.
- Pulse (session + status keys)
- `usage` key + statusLine passthrough (see below)
- `effort` key — display from statusLine, set via `UserPromptSubmit`
- `always-allow` — cheaper than the plan assumed, can move earlier

#### statusLine passthrough

Hooks do **not** carry usage data. The only programmatic source for rate limits
today is the statusLine JSON (`claude usage --json` is an open feature request,
anthropics/claude-code#40793 — it does not exist).

Relevant fields on stdin:

| Field | Notes |
|---|---|
| `rate_limits.five_hour.used_percentage` | 0–100. Account-wide. |
| `rate_limits.five_hour.resets_at` | Unix epoch seconds. |
| `rate_limits.seven_day.used_percentage` / `.resets_at` | Same, weekly window. |
| `context_window.used_percentage` / `.remaining_percentage` | Pre-calculated. Per-session. |
| `context_window.context_window_size` | 200000, or 1000000 on extended-context models. |
| `exceeds_200k_tokens` | Fixed threshold regardless of actual window size. |
| `effort.level` | Live value, reflects mid-session `/effort`. |
| `cost.total_cost_usd` | Session cost. |
| `session_id`, `transcript_path`, `model.display_name` | Correlate to a session slot. |

The script must **print the status line through**, not swallow it — it's replacing
whatever is configured today, so preserve that output or the terminal loses it.

Timing is friendlier than expected: it runs after each new assistant message,
after `/compact`, on permission-mode change, and on vim-mode toggle — **debounced
at 300ms**, not polled. Once per assistant message is nothing. Two caveats: an
in-flight execution is *cancelled* if a new update triggers, so keep the
passthrough fast (Node startup on Windows is ~50–80ms, acceptable); and triggers
go quiet when a session is idle, so the countdown goes stale. `refreshInterval`
(min 1s) re-runs on a timer if that matters — but the key can just render the
last-known value with its age instead.

Note the key shows **account** state, so it doesn't matter which session's
statusLine delivered it. With no session running, nothing fires and the value
ages; render that honestly rather than showing a stale number as current.

### Stage 5 — Injection (optional, may never happen)

Windows-specific and the only real schedule risk.

**Correction:** an earlier version of this plan claimed HTTP hooks can't identify
the calling process, so `focus`/`stop` would need `type: "command"` hooks. Wrong —
agentsd resolves the PID from the incoming socket's remote port (`lsof` on mac,
`netstat -ano` on Windows). HTTP hooks are sufficient. See PORTING.md.

- `focus` — window activation, lift from ono-sendai
- `stop` — **do not port `process.kill(pid, "SIGINT")` naively.** On Windows Node
  ignores the signal and terminates the process outright, killing the session
  instead of interrupting the turn. Skip this key in v1.
- `preset` — text injection, still needs focus + SendKeys

## Design rules to hold

- **Approve and deny are physically inert when nothing is pending.** Not just
  ignored — dark. Muscle memory is exactly how you approve something you never
  read.
- **Auto-target the session that most recently asked; let a session key
  override.** Invisible and correct at one or two agents. At five, "which agent
  am I approving?" becomes a real question, and the `pending` key showing the
  actual command is what keeps it honest.
- **The model is not involved.** Hooks are fired by the harness at fixed
  lifecycle points, not decided by Claude. This is plumbing, not prompting —
  which is why it's reliable, and why the payload is fixed and unsteerable.

## Prior art

- [agentsd](https://github.com/paultyng/agentsd) — MIT. macOS-only, so unusable
  directly, but the closest architectural match: plugin-hosted listener on :9200,
  `PermissionRequest` held open up to 120s. **Read this first.** Its hook-holding
  logic is the thing to lift; its Mac window handling is not.
- [AgentDeck](https://github.com/puritysb/AgentDeck) — MIT, active, Windows daemon
  support. Requires Stream Deck+; the encoders are architectural, not optional, so
  it won't run on an MK.2. Worth reading for the multi-surface daemon model we're
  deliberately not copying.
- [claude-deck](https://github.com/etechlead/claude-deck) — MIT, any Stream Deck,
  Windows. Thin, but it's Stage 0.

## References

- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Stream Deck SDK](https://github.com/elgatosf/streamdeck) ·
  [Keys](https://docs.elgato.com/streamdeck/sdk/guides/keys/) ·
  [Profiles](https://docs.elgato.com/streamdeck/sdk/guides/profiles/) ·
  [Manifest](https://docs.elgato.com/streamdeck/sdk/references/manifest/)
