// Installs/removes the spike's HTTP hooks in ~/.claude/settings.json.
// Modelled on agentsd's scripts/hooks.mjs, which is already fully cross-platform.
//
//   node hooks.mjs install
//   node hooks.mjs uninstall
//
// Safe to run repeatedly — install is idempotent, uninstall removes only our entries
// (matched by URL prefix) and leaves any other hooks alone.

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const BASE_URL = "http://127.0.0.1:9199/hooks";

// Short timeouts everywhere. PermissionRequest gets 120s in the real plugin because
// it holds the response open for a human; the spike answers instantly, so 10s is plenty
// and keeps a dead listener from stalling anything. (Hooks fail open regardless.)
const EVENTS = [
  ["SessionStart", 5],
  ["SessionEnd", 5],
  ["UserPromptSubmit", 5],
  ["PreToolUse", 5],
  ["PostToolUse", 5],
  ["PostToolUseFailure", 5],
  ["Stop", 5],
  ["StopFailure", 5],
  ["PermissionRequest", 10],
  ["PermissionDenied", 5],
  ["Notification", 5],
  ["Elicitation", 10],
];

const isOurs = (h) => h.type === "http" && typeof h.url === "string" && h.url.startsWith(BASE_URL);

async function readSettings() {
  try {
    return JSON.parse(await readFile(SETTINGS_PATH, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

const writeSettings = (s) => writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n", "utf-8");

async function install() {
  const settings = await readSettings();
  const hooks = settings.hooks ?? {};
  for (const [name, timeout] of EVENTS) {
    const matchers = hooks[name] ?? [];
    if (matchers.some((m) => m.hooks.some(isOurs))) continue;
    matchers.push({ matcher: "", hooks: [{ type: "http", url: `${BASE_URL}/${name}`, timeout }] });
    hooks[name] = matchers;
  }
  settings.hooks = hooks;
  await writeSettings(settings);
  console.log(`Installed ${EVENTS.length} spike hooks into ${SETTINGS_PATH}`);
}

async function uninstall() {
  const settings = await readSettings();
  const hooks = settings.hooks ?? {};
  for (const [name] of EVENTS) {
    if (!hooks[name]) continue;
    for (const m of hooks[name]) m.hooks = m.hooks.filter((h) => !isOurs(h));
    hooks[name] = hooks[name].filter((m) => m.hooks.length > 0);
    if (hooks[name].length === 0) delete hooks[name];
  }
  settings.hooks = hooks;
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  await writeSettings(settings);
  console.log(`Removed spike hooks from ${SETTINGS_PATH}`);
}

const cmd = process.argv[2];
if (cmd === "install") await install();
else if (cmd === "uninstall") await uninstall();
else {
  console.error("usage: node hooks.mjs install|uninstall");
  process.exit(1);
}
