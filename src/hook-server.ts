import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { timingSafeEqual } from "node:crypto";
import streamDeck from "@elgato/streamdeck";
import type { SessionManager } from "./session-manager";
import { resolvePidForLocalPort } from "./util/windows";
import type { HookEventName, HookPayload } from "./types";

const VALID_EVENTS = new Set<HookEventName>([
  "SessionStart", "SessionEnd", "UserPromptSubmit",
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "Stop", "StopFailure", "PermissionRequest", "Notification",
  "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted",
  "Elicitation", "ElicitationResult",
]);

/** Default time to hold a PermissionRequest response open before auto-denying. */
const PERMISSION_TIMEOUT_MS = 120_000;
/** Maximum request body size (1 MB). */
const MAX_BODY_BYTES = 1_024 * 1_024;

export interface HookServerOptions {
  /** Expose GET /debug/sessions returning serialized session state. Defaults to env YOLODECK_DEBUG="1". */
  debugEnabled?: boolean;
  /** PermissionRequest hold-open timeout in ms. Defaults to 120s. */
  permissionTimeoutMs?: number;
  /** Shared secret required in the Authorization header. Defaults to env YOLODECK_TOKEN. */
  token?: string;
}

export class HookServer {
  private server: Server | null = null;
  private readonly connections = new Set<Socket>();
  private readonly debugEnabled: boolean;
  private readonly permissionTimeoutMs: number;
  private readonly token: string | null;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly port: number = 9200,
    options: HookServerOptions = {},
  ) {
    this.debugEnabled = options.debugEnabled ?? process.env.YOLODECK_DEBUG === "1";
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS;
    this.token = options.token ?? process.env.YOLODECK_TOKEN ?? null;
  }

  /**
   * NOT IN UPSTREAM. agentsd relies on 127.0.0.1 binding alone, which is not enough:
   * a web page you visit can POST to http://127.0.0.1:9200 from your browser, and this
   * endpoint approves tool calls. A bearer token closes that — browsers cannot set a
   * custom Authorization header cross-origin without a CORS preflight, which we never
   * answer.
   *
   * Claude Code supplies it via the hook config's `headers` + `allowedEnvVars`, so the
   * secret lives in a user env var rather than plaintext in settings.json.
   */
  private authorized(req: IncomingMessage): boolean {
    if (!this.token) return true; // unset → open, matching upstream behaviour
    const header = req.headers.authorization ?? "";
    const expected = `Bearer ${this.token}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Resolved port after start() (useful when constructed with port=0). */
  get listeningPort(): number | null {
    const addr = this.server?.address();
    return addr && typeof addr === "object" ? addr.port : null;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          streamDeck.logger.error(`Unhandled error in request handler: ${err}`);
          if (!res.writableEnded) {
            res.writeHead(500);
            res.end();
          }
        });
      });

      // Track connections for clean shutdown
      this.server.on("connection", (socket: Socket) => {
        this.connections.add(socket);
        socket.on("close", () => this.connections.delete(socket));
      });

      // Persistent error handler for post-startup errors
      this.server.on("error", (err) => {
        streamDeck.logger.error(`HTTP server error: ${err}`);
      });

      this.server.maxConnections = 100;

      this.server.listen(this.port, "127.0.0.1", () => resolve());
      this.server.once("error", reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      // Destroy open connections so server.close() doesn't hang
      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Parse URL once for both debug and hook paths.
    const url = new URL(req.url ?? "", "http://localhost");

    if (!this.authorized(req)) {
      streamDeck.logger.warn(`Rejected unauthorized request to ${url.pathname}`);
      res.writeHead(401);
      res.end();
      return;
    }

    // Debug endpoint (gated). GET only; serves a snapshot of current sessions.
    if (this.debugEnabled && req.method === "GET" && url.pathname === "/debug/sessions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.sessionManager.getSnapshot()));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    const segments = url.pathname.split("/");
    const eventName = segments[2];

    if (!eventName || !VALID_EVENTS.has(eventName as HookEventName)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const validEvent = eventName as HookEventName;

    let payload: HookPayload;
    try {
      payload = await readJson(req);
    } catch (err) {
      const status = err instanceof PayloadTooLargeError ? 413 : 400;
      res.writeHead(status);
      res.end();
      return;
    }

    streamDeck.logger.debug(`Hook request: ${validEvent} session=${payload.session_id ?? "unknown"}`);

    // PermissionRequest: hold the response open
    if (validEvent === "PermissionRequest") {
      streamDeck.logger.info(`PermissionRequest: holding response for session=${payload.session_id} tool=${payload.tool_name ?? "unknown"}`);
      this.sessionManager.handleEvent(validEvent, payload);
      const timer = setTimeout(() => {
        streamDeck.logger.info(`PermissionRequest: timed out for session=${payload.session_id}`);
        // Send explicit deny on timeout instead of ambiguous {}
        if (!res.writableEnded) {
          const body = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Timed out" } } };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        }
        // Clear pending state without trying to write the response again
        this.sessionManager.clearPendingPermissionById(payload.session_id);
      }, this.permissionTimeoutMs);

      this.sessionManager.setPendingPermission(payload.session_id, {
        req,
        res,
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        // Carried through so always-allow can echo Claude Code's own scoped rule
        // rather than inventing a broader one. See resolvePermissionAlwaysAllow.
        suggestions: payload.permission_suggestions,
        timer,
      });
      this.resolveCallerPid(req, payload.session_id);
      return;
    }

    // All other events: process and respond immediately
    this.sessionManager.handleEvent(validEvent, payload);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");

    // Resolve PID from the remote port (fire-and-forget, don't block response)
    this.resolveCallerPid(req, payload.session_id);
  }

  /**
   * Resolve the PID of the Claude Code process from the incoming connection's remote port.
   * Runs asynchronously after the response is sent.
   *
   * WINDOWS PORT — two changes from upstream:
   *
   * 1. `lsof` → `netstat -ano` (see util/windows.ts).
   * 2. Lazy, not per-event. Upstream re-resolves on *every* hook event to "stay fresh";
   *    on macOS lsof is cheap enough for that. On Windows this spawns a process, and
   *    PreToolUse fires constantly — so we resolve once per session and leave it. The
   *    PID of a live session doesn't change, and a stale entry for a dead session is
   *    harmless: focus simply fails, and stale pruning removes the session anyway.
   */
  private resolveCallerPid(req: IncomingMessage, sessionId: string): void {
    if (this.sessionManager.hasPid(sessionId)) return;

    const remotePort = req.socket.remotePort;
    if (!remotePort) return;

    resolvePidForLocalPort(remotePort)
      .then((pid) => {
        if (pid === null) return;
        this.sessionManager.setSessionPid(sessionId, pid);
        streamDeck.logger.debug(`Resolved PID ${pid} for session=${sessionId}`);
      })
      .catch((err) => streamDeck.logger.debug(`PID resolution failed: ${err}`));
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}

function readJson(req: IncomingMessage): Promise<HookPayload> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
