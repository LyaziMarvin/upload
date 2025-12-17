// app/ipc/ollamaHandler.js
const { ipcMain } = require('electron');
const {
  ensureStarted,
  stop,
  getState,
  isHealthy,
  OLLAMA_URL,
  killAll, // NEW import
} = require('./ollamaProcess');

async function fetchWithTimeout(url, opts = {}, ms = 1500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal }); // Node 18+ global fetch
    return res;
  } finally { clearTimeout(id); }
}

// Health/status function (can be called directly)
async function getStatus() {
  try {
    const tagsRes = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 1500);
    if (!tagsRes.ok) return { running: false, httpStatus: tagsRes.status, ...getState() };

    const tags = await tagsRes.json();
    let version = null;
    try {
      const verRes = await fetchWithTimeout(`${OLLAMA_URL}/api/version`, {}, 1000);
      if (verRes.ok) version = (await verRes.json())?.version ?? null;
    } catch (_) {}

    return { running: true, version, models: Array.isArray(tags?.models) ? tags.models : [], ...getState() };
  } catch (err) {
    return { running: false, error: err?.name || 'NETWORK_ERROR', ...getState() };
  }
}

// Health/status (extends your original)
ipcMain.handle('ollama:status', async () => {
  return await getStatus();
});

// explicitly start/ensure
ipcMain.handle('ollama:ensure-started', async () => {
  const ok = await ensureStarted({ log: true });
  return { success: ok, ...(await getStatus()) };
});

// explicitly stop (only if we started it)
ipcMain.handle('ollama:stop', async () => {
  await stop({ log: true });
  const healthy = await isHealthy(); // if a system daemon is up, this can still be true
  return { success: true, stillReachable: healthy, ...(await getStatus()) };
});

// ---- NEW: force-kill all Ollama processes on the machine ----
ipcMain.handle('ollama:kill-all', async () => {
  const { success, stillReachable } = await killAll({ log: true });
  const status = await getStatus();
  return { success, stillReachable, ...status };
});

module.exports = {};
