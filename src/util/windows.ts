// WINDOWS PORT — replaces upstream's src/util/applescript.ts.
//
// Upstream (agentsd, macOS) activated a terminal by name via osascript:
//     tell application "Ghostty" to activate
// It never used the PID it had already resolved, and its own comment admitted the
// focus was best-effort. We can do better on Windows because hook-server resolves
// the Claude Code PID from the incoming socket (see resolveCallerPid).
//
// The complication: Claude Code is a console process, so its own MainWindowHandle is
// usually 0 — the window belongs to whatever hosts the console (WindowsTerminal.exe,
// the Claude desktop app, an IDE). So we walk up the parent chain until we find a
// process that actually owns a window, then raise that.
//
// If ono-sendai's window-management code is ever factored out into something
// reusable, it could replace this wholesale — it solves the same problem.

import { execFile } from "node:child_process";

/**
 * Shared C# type: raises a window to the foreground for real, not just a taskbar
 * flash.
 *
 * Plain SetForegroundWindow from a background process (here, a PowerShell child the
 * Stream Deck plugin spawned) hits Windows' foreground-lock: the OS only grants a
 * foreground-change request to the process that currently owns the foreground input
 * queue, or one that just received input. A PowerShell process spawned on a key press
 * has neither, so the call silently fails and the window only flashes in the taskbar.
 *
 * The standard workaround: temporarily attach this thread's input queue to the
 * current foreground thread's via AttachThreadInput. Once attached, Windows treats
 * this thread as sharing the same input focus rights, so SetForegroundWindow (called
 * from the SAME thread right after) is honored. Detach immediately after — leaving
 * threads attached is a known source of input-routing bugs elsewhere in the system.
 */
const FORCE_FOREGROUND_TYPE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class YoloWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);

  public static void ForceForeground(IntPtr target) {
    ShowWindow(target, 9); // SW_RESTORE — un-minimise first
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, out _);
    uint thisThread = GetCurrentThreadId();
    bool attached = fgThread != thisThread && AttachThreadInput(thisThread, fgThread, true);
    try {
      SetForegroundWindow(target);
      BringWindowToTop(target);
    } finally {
      if (attached) AttachThreadInput(thisThread, fgThread, false);
    }
  }
}
"@
`.trim();

/**
 * Walk up from `pid` through parent processes until one owns a visible window, then
 * bring it to the foreground.
 *
 * SetForegroundWindow is subject to Windows' foreground-lock rules: it can be refused
 * when the calling process doesn't own the current foreground window. ShowWindow with
 * SW_RESTORE first un-minimises and improves the odds. Failure is non-fatal — the
 * worst case is that the window doesn't come forward, which is exactly upstream's
 * worst case too.
 */
export function focusWindowForPid(pid: number): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
${FORCE_FOREGROUND_TYPE}
$target = ${pid}
# Bounded walk — a cycle or an orphaned tree must not spin forever.
for ($i = 0; $i -lt 8 -and $target -gt 0; $i++) {
  $proc = Get-Process -Id $target -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne 0 -and [YoloWin]::IsWindowVisible($proc.MainWindowHandle)) {
    [YoloWin]::ForceForeground($proc.MainWindowHandle)
    exit 0
  }
  $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$target" -ErrorAction SilentlyContinue
  if (-not $ci) { break }
  $target = $ci.ParentProcessId
}
exit 1
`.trim();

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/**
 * Fallback for when no PID has been resolved yet: raise a known terminal by process
 * name. This is upstream's approach, kept only as a backstop — it can't tell one
 * session's window from another's.
 */
export function focusAppByName(...names: string[]): Promise<void> {
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const script = `
$ErrorActionPreference = 'Stop'
${FORCE_FOREGROUND_TYPE}
foreach ($n in @(${list})) {
  $p = Get-Process -Name $n -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    [YoloWin]::ForceForeground($p.MainWindowHandle)
    exit 0
  }
}
exit 1
`.trim();

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/**
 * Resolve the PID that owns an established TCP connection on `localPort`.
 *
 * WINDOWS PORT — replaces upstream's `lsof -i TCP:<port> -t -sTCP:ESTABLISHED`.
 * The incoming socket's *remote* port is the Claude Code process's *local* port, so
 * the OS can name the process for us. netstat is used rather than PowerShell's
 * Get-NetTCPConnection because it avoids paying PowerShell's ~200ms startup on a path
 * that runs per hook event.
 *
 * Output columns:  Proto  Local Address  Foreign Address  State  PID
 */
export function resolvePidForLocalPort(localPort: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("netstat", ["-ano", "-p", "TCP"], (err, stdout) => {
      if (err) return resolve(null);
      for (const line of stdout.split("\n")) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 5 || cols[3] !== "ESTABLISHED") continue;
        // Match the port at the end of the local address — handles both
        // 127.0.0.1:54321 and IPv6 [::1]:54321.
        const local = cols[1];
        if (!local.endsWith(`:${localPort}`)) continue;
        const pid = parseInt(cols[4], 10);
        if (!isNaN(pid) && pid !== process.pid) return resolve(pid);
      }
      resolve(null);
    });
  });
}
