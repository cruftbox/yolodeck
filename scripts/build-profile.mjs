// Generates com.cruftbox.yolodeck.sdPlugin/yolodeck.streamDeckProfile — the layout
// bundled with the plugin, which OverviewButton switches to.
//
// Elgato's documented workflow is to build a profile in the app and export it by hand.
// That produces an opaque binary blob nobody can review or diff, and it has to be
// re-exported by hand whenever the layout changes. The format is a plain ZIP of JSON,
// so generating it keeps the layout in source control as something readable.
//
// Format, reverse-engineered from the profiles shipped in
// "C:\Program Files\Elgato\StreamDeck\DefaultProfiles" and the user's own ProfilesV3:
//
//   <UUID>.sdProfile/manifest.json           { Device:{Model,UUID}, Name, Pages, Version }
//   <UUID>.sdProfile/Profiles/<PAGE>/manifest.json
//                                            { Controllers:[{ Actions:{ "col,row": {...} } }] }
//
// Run: node scripts/build-profile.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const PLUGIN_UUID = "com.cruftbox.yolodeck";
const PLUGIN_NAME = "yolodeck";
const PLUGIN_VERSION = "0.1.0.0";
const PROFILE_NAME = "yolodeck";

// Michael's deck reports as 20GAA9902 (from ProfilesV3). Elgato ships one default
// profile per model for exactly this reason — a profile is bound to a device geometry.
// 5x3, 15 keys.
const DEVICE_MODEL = "20GAA9902";

const OUT = join(
  import.meta.dirname,
  "..",
  "com.cruftbox.yolodeck.sdPlugin",
  `${PROFILE_NAME}.streamDeckProfile`,
);

/** One of our actions at a coordinate. */
const act = (uuid, name, settings = {}) => ({
  ActionID: randomUUID(),
  Name: name,
  Plugin: { Name: PLUGIN_NAME, UUID: PLUGIN_UUID, Version: PLUGIN_VERSION },
  Settings: settings,
  State: 0,
  States: [{}], // no Image: every key renders itself at runtime via setImage
  UUID: `${PLUGIN_UUID}.${uuid}`,
});

/**
 * The built-in Switch Profile action with an empty ProfileUUID, which means "the
 * default profile". This is the return trip the plugin API cannot make itself — and
 * it needs no configuration, which is why the bundled profile can ship it working.
 */
const backToDefault = () => ({
  ActionID: randomUUID(),
  Name: "Switch Profile",
  Plugin: { Name: "Stream Deck", UUID: "com.elgato.streamdeck", Version: "1.0" },
  Settings: { DeviceUUID: "", ProfileUUID: "" },
  State: 0,
  States: [{}],
  UUID: "com.elgato.streamdeck.profile.rotate",
});

// Coordinates are "column,row", zero-indexed from the top-left.
//
//   [ sess ][ sess ][ sess ][ sess ][ sess ]
//   [ stat ][appr. ][ deny ][always][ mode ]
//   [usage ][model ][      ][focus ][ back ]
//
// Session keys are unpinned by default: they claim sessions in deck order, and you pin
// the ones you care about via the property inspector. Row 3 is left mostly empty on
// purpose — usage and effort land there once they exist.
const actions = {
  "0,0": act("session", "Session"),
  "1,0": act("session", "Session"),
  "2,0": act("session", "Session"),
  "3,0": act("session", "Session"),
  "4,0": act("session", "Session"),

  "0,1": act("status", "Status"),
  "1,1": act("approve", "Approve"),
  "2,1": act("deny", "Deny"),
  "3,1": act("always-allow", "Always Allow"),
  "4,1": act("mode", "Mode"),

  "0,2": act("usage", "Usage"),
  "1,2": act("model", "Model"),
  "3,2": act("focus", "Focus"),
  "4,2": backToDefault(),
};

const profileUuid = randomUUID().toUpperCase();
const pageUuid = randomUUID().toLowerCase();

const tmp = mkdtempSync(join(tmpdir(), "yolodeck-profile-"));
const root = join(tmp, `${profileUuid}.sdProfile`);
const page = join(root, "Profiles", pageUuid);
mkdirSync(page, { recursive: true });

writeFileSync(
  join(root, "manifest.json"),
  JSON.stringify({
    Device: { Model: DEVICE_MODEL, UUID: "" }, // empty UUID = any device of this model
    Name: PROFILE_NAME,
    Pages: { Current: pageUuid, Default: pageUuid, Pages: [pageUuid] },
    Version: "3.0",
  }),
);

writeFileSync(
  join(page, "manifest.json"),
  JSON.stringify({ Controllers: [{ Actions: actions }] }),
);

// Zip it via .NET, with entry names written explicitly.
//
// NOT Compress-Archive: it writes backslashes as path separators, which the ZIP spec
// forbids (4.4.17.1 — "all slashes MUST be forward slashes"). unzip warns about it and
// Stream Deck would be within its rights to reject the file. ZipArchive lets us name
// each entry ourselves, so the separators are correct by construction.
rmSync(OUT, { force: true });
const entries = [
  [join(root, "manifest.json"), `${profileUuid}.sdProfile/manifest.json`],
  [join(page, "manifest.json"), `${profileUuid}.sdProfile/Profiles/${pageUuid}/manifest.json`],
];

const ps = [
  `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
  `$zip = [System.IO.Compression.ZipFile]::Open('${OUT}', 'Create')`,
  ...entries.map(
    ([src, name]) =>
      `[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, '${src}', '${name}') | Out-Null`,
  ),
  `$zip.Dispose()`,
].join("; ");

execFileSync("powershell.exe", ["-NoProfile", "-Command", ps]);
rmSync(tmp, { recursive: true, force: true });

console.log(`wrote ${OUT}`);
console.log(`  device ${DEVICE_MODEL}, ${Object.keys(actions).length} keys`);
