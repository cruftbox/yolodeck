import streamDeck from "@elgato/streamdeck";

import { HookServer } from "./hook-server";
import { SessionManager } from "./session-manager";
import { setManager } from "./actions/base";

import { AlwaysAllowButton } from "./actions/always-allow-button";
import { ApproveButton } from "./actions/approve-button";
import { DenyButton } from "./actions/deny-button";
import { FocusButton } from "./actions/focus-button";
import { ModeButton } from "./actions/mode-button";
import { ModelButton } from "./actions/model-button";
import { OverviewButton } from "./actions/overview-button";
import { SessionButton } from "./actions/session-button";
import { StatusButton } from "./actions/status-button";
import { UsageButton } from "./actions/usage-button";

// Removed from upstream:
//   SessionDial — Encoder action; this targets a 15-key MK.2 with no dials.
//   StopButton  — process.kill(pid, "SIGINT") terminates rather than interrupts on
//                 Windows. See session-manager.ts and PORTING.md.

// Global error handlers — prevent silent crashes
process.on("uncaughtException", (err) => {
  streamDeck.logger.error(`Uncaught exception: ${err}`);
});
process.on("unhandledRejection", (err) => {
  streamDeck.logger.error(`Unhandled rejection: ${err}`);
});

const sessionManager = new SessionManager();
const hookServer = new HookServer(sessionManager);

// Wire manager into all managed actions (single setter replaces per-action setters)
setManager(sessionManager);

// Register actions
streamDeck.actions.registerAction(new OverviewButton());
streamDeck.actions.registerAction(new SessionButton());
streamDeck.actions.registerAction(new ModeButton());
streamDeck.actions.registerAction(new ModelButton());
streamDeck.actions.registerAction(new StatusButton());
streamDeck.actions.registerAction(new ApproveButton());
streamDeck.actions.registerAction(new AlwaysAllowButton());
streamDeck.actions.registerAction(new DenyButton());
streamDeck.actions.registerAction(new FocusButton());
streamDeck.actions.registerAction(new UsageButton());

streamDeck.logger.setLevel("info");

// Start hook server
hookServer.start().then(() => {
  streamDeck.logger.info("Hook server listening on :9200");
}).catch((err) => {
  streamDeck.logger.error(`Failed to start hook server: ${err}`);
});

sessionManager.start();

// Graceful shutdown
async function shutdown(): Promise<void> {
  streamDeck.logger.info("Shutting down...");
  sessionManager.stop();
  await hookServer.stop();
}

process.on("SIGTERM", () => { shutdown(); });
process.on("SIGINT", () => { shutdown(); });

// Connect to Stream Deck
streamDeck.connect();
