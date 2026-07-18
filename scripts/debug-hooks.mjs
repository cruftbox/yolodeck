#!/usr/bin/env node

import { createInterface } from "node:readline";

const BASE = "http://127.0.0.1:9200/hooks";
const SESS_A = "debug-sess-aaaa-1111";
const SESS_B = "debug-sess-bbbb-2222";

// ANSI colors matching button states
const C = {
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gold: "\x1b[33m",
  purple: "\x1b[35m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

let stepNum = 0;
let passes = 0;
let failures = [];

async function post(event, payload) {
  const res = await fetch(`${BASE}/${event}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function step(label, expected, fn) {
  stepNum++;
  console.log(
    `\n${C.bold}── Step ${stepNum}: ${label} ──${C.reset}`
  );
  for (const line of expected) {
    console.log(`  ${line}`);
  }

  const result = await fn();
  if (result !== undefined) {
    console.log(`  ${C.dim}→ ${result.status} ${JSON.stringify(result.body)}${C.reset}`);
  }

  const answer = await ask(`  Does this match? (y/n): `);
  if (answer.toLowerCase() === "y") {
    passes++;
    console.log(`  ${C.green}✓ pass${C.reset}`);
  } else {
    failures.push(stepNum);
    console.log(`  ${C.gold}✗ fail${C.reset}`);
  }
}

// ── Steps ──

async function run() {
  console.log(`${C.bold}Stream Deck Hook Debug Script${C.reset}`);
  console.log(`Targeting ${C.dim}${BASE}${C.reset}`);
  console.log(`Sessions: A=${SESS_A}  B=${SESS_B}\n`);
  console.log("Press Enter after visually inspecting each step.\n");

  // 1
  await step("SessionStart (sess-A)", [
    `${C.green}IDLE${C.reset} — green session, "Idle"`,
    `Mode button: "Manual" + "Opus 4.6"`,
  ], () =>
    post("SessionStart", { session_id: SESS_A, cwd: "/tmp/debug", permission_mode: "default", model: "claude-opus-4-6" })
  );

  // 2
  await step("PreToolUse (Read)", [
    `${C.blue}PROCESSING${C.reset} — blue session, status: "Working" / "Read"`,
  ], () =>
    post("PreToolUse", { session_id: SESS_A, tool_name: "Read" })
  );

  // 3
  await step("PostToolUse", [
    `${C.blue}PROCESSING${C.reset} — blue session, status: "Working"`,
  ], () =>
    post("PostToolUse", { session_id: SESS_A, tool_name: "Read" })
  );

  // 4
  await step("PreToolUse (Edit)", [
    `${C.blue}PROCESSING${C.reset} — blue, status: "Working" / "Edit"`,
  ], () =>
    post("PreToolUse", { session_id: SESS_A, tool_name: "Edit" })
  );

  // 5
  await step("PostToolUseFailure", [
    `${C.blue}PROCESSING${C.reset} — blue, status: "Working", lastError set`,
  ], () =>
    post("PostToolUseFailure", { session_id: SESS_A, tool_name: "Edit", error: "simulated failure" })
  );

  // 6
  await step("Stop", [
    `${C.green}IDLE${C.reset} — green, "Idle"`,
  ], () =>
    post("Stop", { session_id: SESS_A })
  );

  // 7
  await step("SubagentStart (1st)", [
    `${C.green}IDLE${C.reset} — status bg ${C.blue}BLUE${C.reset}, "Idle" / "1 agent"`,
  ], () =>
    post("SubagentStart", { session_id: SESS_A })
  );

  // 8
  await step("SubagentStart (2nd)", [
    `${C.green}IDLE${C.reset} — status bg ${C.gold}YELLOW${C.reset}, "Idle" / "2 agents"`,
  ], () =>
    post("SubagentStart", { session_id: SESS_A })
  );

  // 8b
  await step("SubagentStart (3rd)", [
    `${C.green}IDLE${C.reset} — status bg ORANGE, "Idle" / "3 agents"`,
  ], () =>
    post("SubagentStart", { session_id: SESS_A })
  );

  // 9
  await step("SubagentStop (back to 2)", [
    `${C.green}IDLE${C.reset} — status bg ${C.gold}YELLOW${C.reset}, "Idle" / "2 agents"`,
  ], () =>
    post("SubagentStop", { session_id: SESS_A })
  );

  // 10
  await step("SubagentStop (back to 1)", [
    `${C.green}IDLE${C.reset} — status bg ${C.blue}BLUE${C.reset}, "Idle" / "1 agent"`,
  ], () =>
    post("SubagentStop", { session_id: SESS_A })
  );

  // 10b
  await step("SubagentStop (last — back to 0)", [
    `${C.green}IDLE${C.reset} — status bg default (no color), "Idle"`,
  ], () =>
    post("SubagentStop", { session_id: SESS_A })
  );

  // 11
  await step("PreToolUse (Bash)", [
    `${C.blue}PROCESSING${C.reset} — blue, "Bash"`,
  ], () =>
    post("PreToolUse", { session_id: SESS_A, tool_name: "Bash" })
  );

  // 12 — PermissionRequest (held open, auto-foregrounds session)
  await step("PermissionRequest (auto-foreground)", [
    `${C.gold}AWAITING_PERMISSION${C.reset} — gold, "Permission?", approve/deny lit`,
    `Session should auto-foreground if not already active`,
    `Press ${C.bold}APPROVE${C.reset} or ${C.bold}DENY${C.reset} on Stream Deck…`,
  ], async () => {
    const pending = post("PermissionRequest", { session_id: SESS_A, tool_name: "Bash" });
    console.log(`  ${C.dim}(request sent, waiting for physical button press…)${C.reset}`);
    const result = await pending;
    console.log(`  ${C.dim}→ ${result.status} ${JSON.stringify(result.body)}${C.reset}`);
    return undefined; // already printed
  });

  // 13
  await step("Notification", [
    `${C.dim}(no state change, confirm 200)${C.reset}`,
  ], () =>
    post("Notification", { session_id: SESS_A, message: "Debug notification" })
  );

  // 14 — Elicitation (auto-foregrounds session)
  await step("Elicitation (auto-foreground)", [
    `${C.purple}AWAITING_ELICITATION${C.reset} — purple, "Question?"`,
    `Session should auto-foreground if not already active`,
  ], () =>
    post("Elicitation", { session_id: SESS_A })
  );

  // 15
  await step("ElicitationResult", [
    `${C.green}IDLE${C.reset} — green, "Idle"`,
  ], () =>
    post("ElicitationResult", { session_id: SESS_A })
  );

  // -- Permission queue test (multi-session)
  // Start sess-B so we have two sessions
  await step("SessionStart (sess-B for queue test)", [
    `Two sessions — sess-A still active (foreground)`,
  ], () =>
    post("SessionStart", { session_id: SESS_B, cwd: "/tmp/debug-b", permission_mode: "default", model: "claude-sonnet-4-6" })
  );

  // Put sess-A into PROCESSING first
  await step("PreToolUse sess-A (setup for queue)", [
    `${C.blue}PROCESSING${C.reset} — sess-A active, "Bash"`,
  ], () =>
    post("PreToolUse", { session_id: SESS_A, tool_name: "Bash" })
  );

  // Put sess-B into PROCESSING
  await step("PreToolUse sess-B (setup for queue)", [
    `${C.blue}PROCESSING${C.reset} — sess-B processing (may not be visible yet)`,
  ], () =>
    post("PreToolUse", { session_id: SESS_B, tool_name: "Write" })
  );

  // Send PermissionRequest for sess-A — should foreground sess-A
  // NOTE: do NOT await the response yet — it's held open
  let permA;
  await step("PermissionRequest sess-A (queue pos 1)", [
    `${C.gold}AWAITING_PERMISSION${C.reset} — sess-A auto-foregrounded`,
    `Approve/deny buttons lit — ${C.bold}DO NOT press them yet${C.reset}`,
  ], () => {
    permA = post("PermissionRequest", { session_id: SESS_A, tool_name: "Bash" });
    return undefined; // don't await — held open
  });

  // Send PermissionRequest for sess-B — should NOT steal foreground
  let permB;
  await step("PermissionRequest sess-B (queue pos 2)", [
    `Sess-A should ${C.bold}still be foregrounded${C.reset} (not sess-B)`,
    `Approve/deny buttons still show sess-A's permission`,
    `Now press ${C.bold}APPROVE${C.reset} or ${C.bold}DENY${C.reset} for sess-A…`,
  ], async () => {
    permB = post("PermissionRequest", { session_id: SESS_B, tool_name: "Write" });
    console.log(`  ${C.dim}(both permissions sent, waiting for sess-A button press…)${C.reset}`);
    const resultA = await permA;
    console.log(`  ${C.dim}→ sess-A: ${resultA.status} ${JSON.stringify(resultA.body)}${C.reset}`);
    return undefined;
  });

  // After resolving sess-A, sess-B should auto-foreground
  await step("Queue advance — sess-B auto-foregrounded", [
    `${C.gold}AWAITING_PERMISSION${C.reset} — sess-B now foregrounded`,
    `Approve/deny buttons show sess-B's permission ("Write")`,
    `Now press ${C.bold}APPROVE${C.reset} or ${C.bold}DENY${C.reset} for sess-B…`,
  ], async () => {
    console.log(`  ${C.dim}(waiting for sess-B button press…)${C.reset}`);
    const resultB = await permB;
    console.log(`  ${C.dim}→ sess-B: ${resultB.status} ${JSON.stringify(resultB.body)}${C.reset}`);
    return undefined;
  });

  // Clean up sess-B
  await step("SessionEnd (sess-B, queue test cleanup)", [
    `Back to one session (sess-A)`,
  ], () =>
    post("SessionEnd", { session_id: SESS_B })
  );

  // -- Mode change test
  await step("Mode change (acceptEdits)", [
    `Mode button: "Accept" / "Edits" / "Opus 4.6"`,
  ], () =>
    post("PreToolUse", { session_id: SESS_A, tool_name: "Read", permission_mode: "acceptEdits" })
  );

  await step("PostToolUse (restore idle)", [
    `${C.green}IDLE${C.reset}`,
  ], () =>
    post("Stop", { session_id: SESS_A, permission_mode: "default" })
  );

  // -- Multi-session with model
  await step("SessionStart (sess-B, Sonnet)", [
    `Two sessions — dial shows "1/2" or "2/2"`,
    `Tap Session button to cycle, inspect dial`,
    `Sess-B mode: "Manual" + "Sonnet 4.6"`,
  ], () =>
    post("SessionStart", { session_id: SESS_B, cwd: "/tmp/debug-b", permission_mode: "default", model: "claude-sonnet-4-6" })
  );

  // 17
  await step("SessionEnd (sess-B)", [
    `Back to one session (sess-A)`,
  ], () =>
    post("SessionEnd", { session_id: SESS_B })
  );

  // 18
  await step("SessionEnd (sess-A)", [
    `${C.gray}DISCONNECTED${C.reset} — dark gray, "No Session"`,
  ], () =>
    post("SessionEnd", { session_id: SESS_A })
  );

  // ── Summary ──
  console.log(`\n${C.bold}══ Summary ══${C.reset}`);
  console.log(`  Total: ${stepNum}  Pass: ${C.green}${passes}${C.reset}  Fail: ${C.gold}${failures.length}${C.reset}`);
  if (failures.length > 0) {
    console.log(`  Failed steps: ${failures.join(", ")}`);
  }

  rl.close();
  process.exit(failures.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(2);
});
