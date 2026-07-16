import { readFile } from "node:fs/promises";

export interface TranscriptMeta {
  /** Model id from the most recent assistant message, if any. */
  model: string | null;
  /**
   * The session's human title (Claude Code's `customTitle` — the name shown in the
   * conversation list, e.g. "yolodeck", "Tessera", "Orbis Setup").
   *
   * This is the reliable per-session distinguisher. basename(cwd) collapses every
   * session started from the same directory to one name ("micha" for everything run
   * from the home dir); customTitle is distinct per conversation and human-readable.
   */
  title: string | null;
}

/**
 * Read model + title from a Claude Code transcript in a single reverse pass.
 *
 * Scans from the end so the *latest* values win (a session can be renamed; the model
 * can change mid-session), and stops as soon as both are found.
 */
export async function readTranscriptMeta(transcriptPath: string): Promise<TranscriptMeta> {
  let data: string;
  try {
    data = await readFile(transcriptPath, "utf-8");
  } catch {
    return { model: null, title: null };
  }

  const lines = data.trimEnd().split("\n");
  let model: string | null = null;
  let title: string | null = null;

  for (let i = lines.length - 1; i >= 0 && (!model || !title); i--) {
    try {
      const record = JSON.parse(lines[i]);
      if (!title && typeof record.customTitle === "string" && record.customTitle) {
        title = record.customTitle;
      }
      if (!model && record.type === "assistant" && record.message?.model) {
        model = record.message.model;
      }
    } catch {
      // skip malformed lines
    }
  }
  return { model, title };
}
