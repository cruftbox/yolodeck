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
 * foreground-change request to a process that (a) currently owns the foreground input
 * queue, or (b) generated the last input event Windows saw. A background process has
 * neither. Two workarounds stacked here, since either alone has been unreliable in
 * testing from a real Stream Deck key press (as opposed to an interactive shell,
 * which already owns some standing):
 *
 *  1. keybd_event a harmless Alt press/release. Windows credits the CALLING PROCESS
 *     with "just generated input", which is one of the documented conditions for
 *     SetForegroundWindow to succeed. This is the standard trick used by launchers,
 *     AutoHotkey, etc. for exactly this scenario.
 *  2. AttachThreadInput to the current foreground thread, so this thread shares its
 *     input-focus standing for the duration of the call. Detached immediately after —
 *     leaving threads attached is a known source of input-routing bugs elsewhere.
 *
 * Prints diagnostics to stdout (target handle, SetForegroundWindow's own return value,
 * and the foreground window before/after) so failures are debuggable from the log
 * instead of just "it didn't work".
 */
const FORCE_FOREGROUND_TYPE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class YoloWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  const byte VK_MENU = 0x12;
  const uint KEYEVENTF_KEYUP = 0x0002;

  public static string TitleOf(IntPtr h) {
    StringBuilder sb = new StringBuilder(256);
    GetWindowText(h, sb, 256);
    return sb.ToString();
  }

  public static bool ForceForeground(IntPtr target) {
    IntPtr fgBefore = GetForegroundWindow();
    Console.WriteLine("before: " + fgBefore + " '" + TitleOf(fgBefore) + "'");

    ShowWindow(target, 9); // SW_RESTORE

    // Trick 1: fake input, so this process is credited as having just generated it.
    keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
    keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

    // Trick 2: share input-focus standing with whatever currently has it.
    uint fgPid;
    uint fgThread = GetWindowThreadProcessId(fgBefore, out fgPid);
    uint thisThread = GetCurrentThreadId();
    bool attached = fgThread != thisThread && AttachThreadInput(thisThread, fgThread, true);

    bool apiResult;
    try {
      apiResult = SetForegroundWindow(target);
      BringWindowToTop(target);
    } finally {
      if (attached) AttachThreadInput(thisThread, fgThread, false);
    }

    System.Threading.Thread.Sleep(150);
    IntPtr fgAfter = GetForegroundWindow();
    Console.WriteLine("SetForegroundWindow returned: " + apiResult);
    Console.WriteLine("after: " + fgAfter + " '" + TitleOf(fgAfter) + "'");
    return fgAfter == target;
  }
}
"@
`.trim();

/**
 * Walk up from `pid` through parent processes until one owns a visible window, then
 * bring it to the foreground. Resolves with the script's stdout (diagnostics) and
 * whether the target actually ended up foreground — success is not assumed just
 * because the process exited 0.
 */
export function focusWindowForPid(pid: number): Promise<{ ok: boolean; log: string }> {
  const script = `
$ErrorActionPreference = 'Stop'
${FORCE_FOREGROUND_TYPE}
$target = ${pid}
for ($i = 0; $i -lt 8 -and $target -gt 0; $i++) {
  $proc = Get-Process -Id $target -ErrorAction SilentlyContinue
  Write-Output ("checking pid $target handle=" + $(if ($proc) { $proc.MainWindowHandle } else { "n/a" }))
  if ($proc -and $proc.MainWindowHandle -ne 0 -and [YoloWin]::IsWindowVisible($proc.MainWindowHandle)) {
    $ok = [YoloWin]::ForceForeground($proc.MainWindowHandle)
    Write-Output ("RESULT=" + $ok)
    exit $(if ($ok) { 0 } else { 2 })
  }
  $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$target" -ErrorAction SilentlyContinue
  if (-not $ci) { Write-Output "no parent found"; break }
  $target = $ci.ParentProcessId
}
Write-Output "walk exhausted, no visible window found"
exit 1
`.trim();

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      (err, stdout, stderr) => {
        resolve({ ok: !err, log: (stdout + stderr).trim() });
      },
    );
  });
}

/**
 * Fallback for when no PID has been resolved yet: raise a known terminal by process
 * name. This is upstream's approach, kept only as a backstop — it can't tell one
 * session's window from another's.
 */
export function focusAppByName(...names: string[]): Promise<{ ok: boolean; log: string }> {
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const script = `
$ErrorActionPreference = 'Stop'
${FORCE_FOREGROUND_TYPE}
foreach ($n in @(${list})) {
  $matches = Get-Process -Name $n -ErrorAction SilentlyContinue
  Write-Output ("name=$n candidates=" + ($matches | Measure-Object).Count)
  $p = $matches | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    Write-Output ("using pid=" + $p.Id + " handle=" + $p.MainWindowHandle)
    $ok = [YoloWin]::ForceForeground($p.MainWindowHandle)
    Write-Output ("RESULT=" + $ok)
    exit $(if ($ok) { 0 } else { 2 })
  }
}
Write-Output "no matching process with a window found"
exit 1
`.trim();

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      (err, stdout, stderr) => {
        resolve({ ok: !err, log: (stdout + stderr).trim() });
      },
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
