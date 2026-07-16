import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTranscriptMeta } from "../../src/util/transcript";

let workDir: string | null = null;

async function writeJsonl(lines: unknown[]): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), "transcript-"));
  const path = join(workDir, "transcript.jsonl");
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

describe("readTranscriptMeta — model", () => {
  it("returns the model from the most recent assistant message", async () => {
    const path = await writeJsonl([
      { type: "user", message: { role: "user", content: "hi" } },
      { type: "assistant", message: { role: "assistant", model: "claude-sonnet-4-6", content: "hi back" } },
      { type: "user", message: { role: "user", content: "follow up" } },
      { type: "assistant", message: { role: "assistant", model: "claude-opus-4-7", content: "ok" } },
    ]);
    expect((await readTranscriptMeta(path)).model).toBe("claude-opus-4-7");
  });

  it("returns null model when the file does not exist", async () => {
    expect((await readTranscriptMeta("/nonexistent/path/transcript.jsonl")).model).toBeNull();
  });

  it("skips malformed lines and returns the newest valid assistant model", async () => {
    workDir = await mkdtemp(join(tmpdir(), "transcript-"));
    const path = join(workDir, "transcript.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6" } }),
        "this is not json",
        JSON.stringify({ type: "user", message: { content: "hi" } }),
        "{broken",
      ].join("\n"),
    );
    expect((await readTranscriptMeta(path)).model).toBe("claude-sonnet-4-6");
  });

  it("returns null model when there are no assistant messages", async () => {
    const path = await writeJsonl([
      { type: "user", message: { content: "hi" } },
      { type: "user", message: { content: "anyone there?" } },
    ]);
    expect((await readTranscriptMeta(path)).model).toBeNull();
  });
});

describe("readTranscriptMeta — title", () => {
  // customTitle is the real per-session name. This is the field that fixes every
  // home-dir session rendering as "micha".
  it("returns the customTitle", async () => {
    const path = await writeJsonl([
      { type: "queue-operation", customTitle: "yolodeck" },
      { type: "user", message: { content: "hi" } },
    ]);
    expect((await readTranscriptMeta(path)).title).toBe("yolodeck");
  });

  it("returns the most recent customTitle if the session was renamed", async () => {
    const path = await writeJsonl([
      { type: "queue-operation", customTitle: "old name" },
      { type: "user", message: { content: "work" } },
      { type: "queue-operation", customTitle: "new name" },
    ]);
    expect((await readTranscriptMeta(path)).title).toBe("new name");
  });

  it("returns null title when the session has no customTitle yet", async () => {
    const path = await writeJsonl([
      { type: "user", message: { content: "unnamed session" } },
      { type: "assistant", message: { model: "claude-opus-4-8" } },
    ]);
    expect((await readTranscriptMeta(path)).title).toBeNull();
  });

  it("reads model and title together in one pass", async () => {
    const path = await writeJsonl([
      { type: "queue-operation", customTitle: "Tessera" },
      { type: "assistant", message: { model: "claude-sonnet-5" } },
    ]);
    const meta = await readTranscriptMeta(path);
    expect(meta.title).toBe("Tessera");
    expect(meta.model).toBe("claude-sonnet-5");
  });
});
