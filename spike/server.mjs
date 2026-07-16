// Stage 0.5 spike listener. Throwaway — answers three questions before we build anything:
//
//   1. Do the permission prompts Michael actually gets fire PermissionRequest hooks at all?
//      (defaultMode is bypassPermissions, yet prompts still appear for Read/WebFetch.
//      If those prompts bypass the hook system, yolodeck can't see them and Stage 3 is dead.)
//   2. Does a *running* session pick up newly-installed hooks, or are they snapshot at start?
//   3. What is the real PermissionRequest payload shape? (Docs show PreToolUse's
//      permissionDecision/permissionDecisionReason; agentsd ships decision:{behavior,message}.)
//
// Deliberately non-invasive: every event is logged and answered with {} so Claude Code
// falls through to its normal flow. This observes; it never decides.

import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 9199;
const LOG = join(dirname(fileURLToPath(import.meta.url)), "events.log");

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(LOG, stamped + "\n");
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const event = new URL(req.url ?? "", "http://localhost").pathname.split("/")[2] ?? "?";
  const payload = await readBody(req);

  // PermissionRequest is the one we care most about — dump everything.
  if (event === "PermissionRequest" || event === "Elicitation" || event === "Notification") {
    log(`>>> ${event} FULL PAYLOAD:\n${JSON.stringify(payload, null, 2)}`);
  } else {
    const bits = [
      `session=${(payload.session_id ?? "?").slice(0, 8)}`,
      payload.tool_name ? `tool=${payload.tool_name}` : null,
      payload.permission_mode ? `mode=${payload.permission_mode}` : null,
    ].filter(Boolean);
    log(`${event.padEnd(20)} ${bits.join(" ")}`);
  }

  // Probe: auto-allow one narrowly-scoped case to settle two questions at once —
  // (a) does returning a decision actually suppress the TUI dialog, and
  // (b) which response shape is real? Docs document permissionDecision/permissionDecisionReason
  //     for PreToolUse; agentsd ships decision:{behavior,message} for PermissionRequest.
  // SHAPE=docs|agentsd selects which to send. Scoped to Read of System32 so nothing else
  // on this machine is auto-approved while the spike runs.
  const probeTarget =
    event === "PermissionRequest" &&
    payload.tool_name === "Read" &&
    String(payload.tool_input?.file_path ?? "").includes("System32");

  if (probeTarget) {
    const shape = process.env.SHAPE ?? "agentsd";
    const body =
      shape === "docs"
        ? { hookSpecificOutput: { hookEventName: "PermissionRequest", permissionDecision: "allow" } }
        : { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
    log(`<<< auto-allowing (shape=${shape}): ${JSON.stringify(body)}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }

  // Everything else: empty decision → Claude Code proceeds normally. Strictly an observer.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end("{}");
});

// 127.0.0.1 explicitly. server.listen(PORT) alone binds every interface — on this
// LAN that would expose the endpoint to the NAS, the Pi, and every ESP32 panel.
server.listen(PORT, "127.0.0.1", () => {
  log(`spike listener up on 127.0.0.1:${PORT} — logging to ${LOG}`);
});
