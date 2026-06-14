const { spawn } = require('child_process');

// Control de escritorio LOCAL: las "manos" de Jarvis en la máquina donde corre.
// codex es local-first (el daemon ya vive en el PC del usuario), así que no hace
// falta el modelo daemon+sidecar remoto de otros Jarvis — se controla directo.
// Windows-first vía PowerShell con C# inline (Add-Type), sin DLL externa, para
// que el instalador white-label no arrastre binarios. mac/linux: honesto "aún no".
//
// Gobernanza: estas tools son de alto riesgo (mueven la máquina del usuario) →
// el policy-engine pide confirmación salvo go-ahead, y todo queda en el audit.

const IS_WINDOWS = process.platform === 'win32';
const NOT_SUPPORTED = { ok: false, error: 'DESKTOP_CONTROL_WINDOWS_ONLY', note: 'El control de escritorio local solo está disponible en Windows por ahora.' };

function runPowerShell(script, env = {}) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      env: { ...process.env, ...env }
    });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => { stdout += d.toString(); });
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `PowerShell terminó con código ${code}`));
      resolve(stdout.trim());
    });
    ps.stdin.write(`${script}\n`);
    ps.stdin.end();
  });
}

// Bloque C# compartido: enumeración de ventanas visibles con título.
const WIN_ENUM_CSHARP = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class JarvisWin {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> Handles() {
    var hs = new List<IntPtr>();
    EnumWindows((h, p) => { if (IsWindowVisible(h) && GetWindowTextLength(h) > 0) hs.Add(h); return true; }, IntPtr.Zero);
    return hs;
  }
  static string Title(IntPtr h) { int n = GetWindowTextLength(h); var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  static string Proc(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; } }
  public static string ListLines() {
    var sb = new StringBuilder();
    foreach (var h in Handles()) sb.Append(Proc(h)).Append('\\t').Append(Title(h)).Append('\\n');
    return sb.ToString();
  }
  public static bool Focus(string q) {
    q = (q ?? "").ToLower();
    foreach (var h in Handles()) {
      if ((Title(h) + " " + Proc(h)).ToLower().Contains(q)) {
        ShowWindow(h, 9); // SW_RESTORE
        return SetForegroundWindow(h);
      }
    }
    return false;
  }
}`;

async function listWindows() {
  if (!IS_WINDOWS) return NOT_SUPPORTED;
  const script = `$c = @'\n${WIN_ENUM_CSHARP}\n'@\nAdd-Type $c\n[JarvisWin]::ListLines()`;
  const out = await runPowerShell(script);
  const windows = out.split(/\r?\n/).map((line) => {
    const [proc, ...rest] = line.split('\t');
    const title = rest.join('\t').trim();
    if (!title) return null;
    return { process: (proc || '').trim(), title };
  }).filter(Boolean);
  return { ok: true, count: windows.length, windows };
}

async function focusWindow(query) {
  if (!IS_WINDOWS) return NOT_SUPPORTED;
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'QUERY_REQUIRED' };
  // El query viaja por variable de entorno, NUNCA interpolado en el script:
  // evita cualquier inyección de PowerShell desde texto del modelo/usuario.
  const script = `$c = @'\n${WIN_ENUM_CSHARP}\n'@\nAdd-Type $c\nif ([JarvisWin]::Focus($env:JARVIS_WIN_QUERY)) { 'ok' } else { 'notfound' }`;
  const out = await runPowerShell(script, { JARVIS_WIN_QUERY: q });
  return out.includes('ok')
    ? { ok: true, focused: q }
    : { ok: false, error: 'WINDOW_NOT_FOUND', query: q };
}

// Lanzar app o URL: spawn con argumentos separados (no string de comando) para
// evitar inyección. cmd /c start "" <target>.
function launch(target) {
  if (!IS_WINDOWS) return NOT_SUPPORTED;
  const t = String(target || '').trim();
  if (!t) return { ok: false, error: 'TARGET_REQUIRED' };
  try {
    const child = spawn('cmd', ['/c', 'start', '', t], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, launched: t };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function openUrl(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'INVALID_URL', note: 'Solo se abren URLs http(s).' };
  return launch(u);
}

function createDesktopTools() {
  return [
    {
      name: 'desktop.list_windows',
      description: 'Listar las ventanas abiertas en la máquina local (proceso + título). Útil antes de enfocar una ventana o para saber qué tiene abierto el usuario. Sin input. Solo Windows.',
      risk: 'low',
      permissions: ['desktop:read'],
      execute: async () => listWindows()
    },
    {
      name: 'desktop.focus_window',
      description: 'Traer al frente una ventana abierta de la máquina local, buscándola por título o nombre de proceso (ej: "chrome", "word", "rishtedar"). Input: { query }. Resuelve pedidos como "enfoca la ventana donde tengo X". Solo Windows.',
      risk: 'high',
      permissions: ['desktop:control'],
      execute: async (input) => focusWindow(input.query)
    },
    {
      name: 'desktop.open_app',
      description: 'Abrir una aplicación de la máquina local por nombre o ruta de ejecutable (ej: "notepad", "calc", "spotify"). Input: { name }. Solo Windows.',
      risk: 'high',
      permissions: ['desktop:control'],
      execute: async (input) => launch(input.name)
    },
    {
      name: 'desktop.open_url',
      description: 'Abrir una URL en el navegador por defecto de la máquina local (pestaña nueva). Input: { url } (debe ser http/https). Solo Windows.',
      risk: 'medium',
      permissions: ['desktop:control'],
      execute: async (input) => openUrl(input.url)
    }
  ];
}

module.exports = {
  createDesktopTools,
  listWindows,
  focusWindow,
  openUrl,
  IS_WINDOWS
};
