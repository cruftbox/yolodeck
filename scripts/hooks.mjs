import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

// 127.0.0.1, never localhost — localhost can resolve to ::1 first and miss the listener.
const BASE_URL = "http://127.0.0.1:9200/hooks";

// NOT IN UPSTREAM. agentsd's listener has no auth at all, relying on loopback binding
// alone. That isn't enough: a web page you visit can POST to 127.0.0.1:9200 from your
// browser, and this endpoint approves tool calls.
//
// `allowedEnvVars` is what makes Claude Code interpolate $YOLODECK_TOKEN into the header,
// and it keeps the secret in a user env var instead of plaintext in settings.json.
// Browsers can't set a custom Authorization header cross-origin without a CORS preflight,
// which the plugin never answers — so this closes the hole.
//
// Set it on Windows with:  setx YOLODECK_TOKEN "<32 random bytes, hex>"
// If unset, the plugin runs open and logs a warning (upstream's behaviour).
const TOKEN_VAR = "YOLODECK_TOKEN";

const HOOK_EVENTS = [
  { name: "SessionStart", timeout: 5 },
  { name: "SessionEnd", timeout: 5 },
  { name: "UserPromptSubmit", timeout: 5 },
  { name: "PreToolUse", timeout: 5 },
  { name: "PostToolUse", timeout: 5 },
  { name: "PostToolUseFailure", timeout: 5 },
  { name: "Stop", timeout: 5 },
  { name: "StopFailure", timeout: 5 },
  { name: "PermissionRequest", timeout: 120 },
  { name: "Notification", timeout: 5 },
  { name: "SubagentStart", timeout: 5 },
  { name: "SubagentStop", timeout: 5 },
  { name: "TaskCreated", timeout: 5 },
  { name: "TaskCompleted", timeout: 5 },
  { name: "Elicitation", timeout: 5 },
  { name: "ElicitationResult", timeout: 5 },
];

async function readSettings() {
  try {
    return JSON.parse(await readFile(SETTINGS_PATH, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeSettings(settings) {
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

const isOurs = (h) => h.type === "http" && h.url.startsWith(BASE_URL);

export async function install() {
  const settings = await readSettings();
  const hooks = settings.hooks ?? {};

  for (const { name, timeout } of HOOK_EVENTS) {
    const matchers = hooks[name] ?? [];
    if (matchers.some((m) => m.hooks.some(isOurs))) continue;
    matchers.push({
      matcher: "",
      hooks: [{
        type: "http",
        url: `${BASE_URL}/${name}`,
        timeout,
        headers: { Authorization: `Bearer $${TOKEN_VAR}` },
        allowedEnvVars: [TOKEN_VAR],
      }],
    });
    hooks[name] = matchers;
  }

  settings.hooks = hooks;
  await writeSettings(settings);
  console.log("Hooks installed into", SETTINGS_PATH);

  if (!process.env[TOKEN_VAR]) {
    console.warn(
      `\n  WARNING: ${TOKEN_VAR} is not set. The listener will accept any local request,\n` +
      `  including one from a web page you visit — and it approves tool calls.\n` +
      `  Generate one and restart the Stream Deck app:\n\n` +
      `    setx ${TOKEN_VAR} "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"\n`,
    );
  }
}

export async function uninstall() {
  const settings = await readSettings();
  const hooks = settings.hooks ?? {};

  for (const { name } of HOOK_EVENTS) {
    const matchers = hooks[name];
    if (!matchers) continue;
    for (const m of matchers) m.hooks = m.hooks.filter((h) => !isOurs(h));
    hooks[name] = matchers.filter((m) => m.hooks.length > 0);
    if (hooks[name].length === 0) delete hooks[name];
  }

  settings.hooks = hooks;
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  await writeSettings(settings);
  console.log("Hooks removed from", SETTINGS_PATH);
}
