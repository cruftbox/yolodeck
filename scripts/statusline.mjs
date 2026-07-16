// Claude Code statusLine passthrough.
//
// Hooks carry no usage data whatsoever, and `claude usage --json` does not exist
// (anthropics/claude-code#40793 is open), so the statusLine JSON is currently the only
// programmatic source of rate limits. statusLine is `type: "command"` only — there is
// no http handler type for it — which is why this script exists at all.
//
// Reads Claude Code's JSON on stdin, forwards it to the plugin, and prints a status
// line to stdout. It must PRINT THROUGH: whatever this outputs is your status line,
// so swallowing the payload silently would cost you the terminal display in exchange
// for the deck key.
//
// Timing: Claude Code runs this after each assistant message, after /compact, on
// permission-mode change, and on vim-mode toggle — debounced at 300ms, not polled.
// An in-flight run is CANCELLED if a new update fires, so this stays bounded: the POST
// gets a short timeout and failure is silent. A dead plugin must never cost you a
// status line.

import { readFileSync } from "node:fs";

const URL_ = "http://127.0.0.1:9200/statusline";
const POST_TIMEOUT_MS = 300;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** "2h14m" / "48m" / "9m" — the countdown is the actionable half of a rate limit. */
function until(epochSeconds) {
  const mins = Math.max(0, Math.round((epochSeconds * 1000 - Date.now()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
}

function statusLine(d) {
  const parts = [];

  const model = d.model?.display_name;
  if (model) parts.push(model);

  const ctx = d.context_window?.used_percentage;
  if (typeof ctx === "number") parts.push(`${Math.round(ctx)}% ctx`);

  const fh = d.rate_limits?.five_hour;
  if (fh && typeof fh.used_percentage === "number") {
    const left = Math.round(100 - fh.used_percentage);
    const reset = fh.resets_at ? ` · ${until(fh.resets_at)}` : "";
    parts.push(`${left}% left${reset}`);
  }

  const cost = d.cost?.total_cost_usd;
  if (typeof cost === "number" && cost > 0) parts.push(`$${cost.toFixed(2)}`);

  return parts.join("  ·  ");
}

const data = readStdin();
if (!data) process.exit(0);

const token = process.env.YOLODECK_TOKEN;

try {
  await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
} catch {
  // Plugin down, Stream Deck closed, timed out — all fine. Print the line anyway.
}

console.log(statusLine(data));
