// app/ipc/ollamaProcess.js
const { spawn } = require('node:child_process');

const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = process.env.OLLAMA_PORT || '11434';
const OLLAMA_URL  = process.env.OLLAMA_URL  || `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;
const OLLAMA_BIN  = process.env.OLLAMA_EXECUTABLE || 'ollama';

let proc = null;
let startedByApp = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithTimeout(url, opts = {}, ms = 1500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal }); // Node 18+ global fetch
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function isHealthy() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 800);
    return res?.ok;
  } catch { return false; }
}

async function ensureStarted({ waitMs = 20000, log = true } = {}) {
  // If already serving (system daemon or previously started), don’t spawn again
  if (await isHealthy()) {
    if (log) console.log(`[ollama] using existing instance at ${OLLAMA_URL}`);
    startedByApp = false;
    return true;
  }

  if (proc && !proc.killed) return true;

  if (log) console.log('[ollama] starting server…');
  proc = spawn(OLLAMA_BIN, ['serve'], {
    env: { ...process.env, OLLAMA_HOST: `${OLLAMA_HOST}:${OLLAMA_PORT}` },
    stdio: 'ignore', // change to 'inherit' to see Ollama logs in console
    detached: false,
  });

  startedByApp = true;
  proc.on('error', (err) => console.error('[ollama] failed to start:', err));

  const start = Date.now();
  while (Date.now() - start < waitMs) {
    if (await isHealthy()) {
      if (log) console.log(`[ollama] ready on ${OLLAMA_URL}`);
      return true;
    }
    await sleep(300);
  }
  console.error('[ollama] did not become healthy in time.');
  return false;
}

async function stop({ signal = 'SIGTERM', waitMs = 8000, log = true } = {}) {
  // Only stop if we started it. If a system daemon was running, leave it alone.
  if (!startedByApp || !proc || proc.killed) return;

  if (log) console.log('[ollama] stopping…');
  try { proc.kill(signal); } catch {}

  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), waitMs);
    proc.on('exit', () => { clearTimeout(timer); resolve(true); });
  });

  if (!exited) {
    // Force kill if stubborn
    try {
      if (process.platform === 'win32') {
        const { spawn } = require('node:child_process');
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
      } else {
        process.kill(-proc.pid, 'SIGKILL');
      }
    } catch {}
  }

  proc = null;
  startedByApp = false;
  if (log) console.log('[ollama] stopped.');
}

function getState() {
  return {
    url: OLLAMA_URL,
    running: !!proc && !proc.killed,
    startedByApp,
    pid: proc?.pid || null,
  };
}

// ---- NEW: helpers for "kill all" functionality ----

// Run a system command and resolve with minimal result
function runCmd(cmd, args = [], { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let stderr = '';
    let exited = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    const timer = setTimeout(() => {
      if (!exited) {
        try { child.kill('SIGKILL'); } catch {}
        resolve({ ok: false, code: null, stderr: 'timeout' });
      }
    }, timeoutMs);

    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      exited = true;
      resolve({ ok: false, code: null, stderr: String(err?.message || err) });
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      exited = true;
      resolve({ ok: code === 0, code, stderr });
    });
  });
}

/**
 * Kill ALL Ollama processes on this machine, regardless of who started them.
 * Windows: taskkill /IM ollama.exe /F /T
 * Unix: pkill -f ollama  (fallback: killall ollama)
 * Returns { success, stillReachable }
 */
async function killAll({ log = true, verifyMs = 1500 } = {}) {
  if (log) console.log('[ollama] kill-all requested…');

  let success = false;

  if (process.platform === 'win32') {
    const res = await runCmd('taskkill', ['/IM', 'ollama.exe', '/F', '/T']);
    // Treat "no tasks running" as success
    success = res.ok || /not found|No tasks are running/i.test(res.stderr || '');
    if (!success && log) console.warn('[ollama] taskkill stderr:', res.stderr);
  } else {
    // Prefer pkill -f (matches full cmdline), fall back to killall
    let res = await runCmd('pkill', ['-f', 'ollama']);
    if (!res.ok) {
      if (log) console.warn('[ollama] pkill failed, trying killall…', res.stderr);
      res = await runCmd('killall', ['ollama']);
    }
    // If no processes matched, many systems return nonzero; treat as success
    success = res.ok || /no matching processes|not found|no process found/i.test(res.stderr || '');
    if (!success && log) console.warn('[ollama] killall stderr:', res.stderr);
  }

  // Clear local state if we owned a proc
  if (proc && !proc.killed) {
    try { proc.kill('SIGKILL'); } catch {}
  }
  proc = null;
  startedByApp = false;

  // Optional quick verify—if an external daemon restarts, /api/tags may still be reachable
  await sleep(verifyMs);
  const reachable = await isHealthy();
  if (log) {
    console.log(`[ollama] kill-all ok=${success}. API reachable after kill? ${reachable}`);
  }

  return { success, stillReachable: reachable };
}

module.exports = {
  ensureStarted,
  stop,
  getState,
  isHealthy,
  OLLAMA_URL,
  killAll, // NEW export
};
