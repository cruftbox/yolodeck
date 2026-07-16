// Installs/removes the statusLine entry in ~/.claude/settings.json.
//
//   node scripts/statusline-config.mjs install
//   node scripts/statusline-config.mjs uninstall
//
// Separate from hooks.mjs on purpose: `statusLine` is its own settings key and its own
// mechanism. Hooks deliver events; the statusLine delivers metrics that no hook carries.
//
// Refuses to clobber an existing statusLine that isn't ours — whatever is configured
// there is your terminal display, and silently replacing it would be rude.

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const SCRIPT = resolve(import.meta.dirname, "statusline.mjs");

// Quoted: the path runs through a shell and Windows paths contain spaces
// ("C:\Users\...\Program Files\..."). Unquoted, node would receive fragments.
const COMMAND = `node "${SCRIPT}"`;

const isOurs = (sl) => typeof sl?.command === "string" && sl.command.includes("statusline.mjs");

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

  if (settings.statusLine && !isOurs(settings.statusLine)) {
    console.error(
      `\n  Refusing to overwrite your existing statusLine:\n\n` +
      `    ${JSON.stringify(settings.statusLine)}\n\n` +
      `  Only one statusLine can be configured. To use yolodeck's, remove yours first,\n` +
      `  or fold your own output into ${SCRIPT}\n`,
    );
    process.exit(1);
  }

  settings.statusLine = { type: "command", command: COMMAND };
  await writeSettings(settings);
  console.log(`Installed statusLine into ${SETTINGS_PATH}`);
  console.log(`  ${COMMAND}`);

  if (!process.env.YOLODECK_TOKEN) {
    console.warn(`\n  WARNING: YOLODECK_TOKEN is not set — the plugin will reject these posts.\n`);
  }
}

async function uninstall() {
  const settings = await readSettings();
  if (!settings.statusLine) {
    console.log("No statusLine configured; nothing to do.");
    return;
  }
  if (!isOurs(settings.statusLine)) {
    console.error("The configured statusLine isn't yolodeck's. Leaving it alone.");
    process.exit(1);
  }
  delete settings.statusLine;
  await writeSettings(settings);
  console.log(`Removed statusLine from ${SETTINGS_PATH}`);
}

const cmd = process.argv[2];
if (cmd === "install") await install();
else if (cmd === "uninstall") await uninstall();
else {
  console.error("usage: node scripts/statusline-config.mjs install|uninstall");
  process.exit(1);
}
