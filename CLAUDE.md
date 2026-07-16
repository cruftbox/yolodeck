# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

agentsd — a Stream Deck plugin for orchestrating local AI agent usage. Early stages.

## Build & Test

Use npm scripts only — no Taskfile or Makefile.

- `npm run build` — rollup build → `com.cruftbox.yolodeck.sdPlugin/bin/plugin.js`
- `npm run watch` — rollup watch mode
- `npm run dev` — Stream Deck dev mode
- `npm run link` / `npm run unlink` — link/unlink plugin in Stream Deck
- `npm run hooks:install` / `npm run hooks:uninstall` — manage Claude Code HTTP hooks in `~/.claude/settings.json`
- `npm run debug:hooks` — interactive hook debug script

## Architecture

Claude Code HTTP hooks → Plugin HTTP server (127.0.0.1:9200) → SessionManager → Stream Deck button/dial updates.
No bridge daemon, no PTY parsing. PermissionRequest hooks hold HTTP response open (120s timeout) for approve/deny from hardware buttons.

### State machine

Sessions move through 5 states: `DISCONNECTED → IDLE → PROCESSING → AWAITING_PERMISSION / AWAITING_ELICITATION`.
Auto-created sessions (missed SessionStart) start as `IDLE`. Current-state guards prevent nonsensical transitions (e.g. tool events from DISCONNECTED).
PostToolUse intentionally stays in PROCESSING — Stop moves to IDLE.

### Key behaviors

- **Auto-foreground**: Elicitation and PermissionRequest events bring the session to the active slot.
- **Stale pruning**: Sessions with no activity for 60s are pruned (PRUNE_INTERVAL_MS = 60s check).
- **Permission timeout**: 120s (PERMISSION_TIMEOUT_MS). Sends explicit deny on timeout.
- **Action DI pattern**: A single `setManager()` call in `plugin.ts` wires the `SessionManager` into all `ManagedAction` subclasses via a shared module-level reference in `actions/base.ts`.
