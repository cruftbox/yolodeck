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
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class YoloWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$target = ${pid}
# Bounded walk — a cycle or an orphaned tree must not spin forever.
for ($i = 0; $i -lt 8 -and $target -gt 0; $i++) {
  $proc = Get-Process -Id $target -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne 0 -and [YoloWin]::IsWindowVisible($proc.MainWindowHandle)) {
    [YoloWin]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null   # 9 = SW_RESTORE
    [YoloWin]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
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
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class YoloWinByName {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
foreach ($n in @(${list})) {
  $p = Get-Process -Name $n -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    [YoloWinByName]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
    [YoloWinByName]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
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
