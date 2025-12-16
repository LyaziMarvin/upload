// src/main.js
const { app, BrowserWindow, ipcMain, nativeImage, Menu } = require('electron'); // ← add Menu
const path = require('path');

// ✅ Load ALL IPC handlers (auth, uploads, records, photos, Granite on/off, etc.)
require('../app/ipc/ipcMainHandlers');

// 🔌 Ollama lifecycle on app launch/quit
const { ensureStarted, stop: stopOllama } = require('../app/ipc/ollamaProcess');

// ✅ NEW: keep-alive pings for Granite & embeddings
const { startKeepAlive, stopKeepAlive } = require('../app/ipc/keepAlive');

let mainWindow;

function getIconPath() {
  const base = process.resourcesPath || path.join(__dirname, '..');
  if (process.platform === 'win32') return path.join(base, 'assets', 'icons', 'family-circle.ico');
  if (process.platform === 'darwin') return path.join(base, 'assets', 'icons', 'family-circle.icns');
  return path.join(base, 'assets', 'icons', 'family-circle.png');
}

function createWindow() {
  const iconPath = getIconPath();

  if (process.platform === 'darwin') {
    try {
      const dockImg = nativeImage.createFromPath(iconPath);
      if (!dockImg.isEmpty()) app.dock.setIcon(dockImg);
    } catch (_) {}
  }

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: iconPath,
    // Optional: also hide the menu bar chrome on Win/Linux
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  // 🔕 Remove the default app menu (File/Edit/View/Window/Help)
  Menu.setApplicationMenu(null);

  // Optional: prevent Alt key from showing it on Win/Linux
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, '../public/login.html'));
}

app.whenReady().then(async () => {
  try {
    // Ensure local Ollama is up before we begin pings
    await ensureStarted({ log: true });
  } catch (e) {
    console.warn('Ollama start on app launch failed:', e.message);
  }

  // ✅ Start periodic keep-alive pings
  try {
    startKeepAlive();
  } catch (e) {
    console.warn('Keep-alive start failed:', e.message);
  }

  createWindow();
});

ipcMain.on('navigate-to', (_event, page) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    console.log('Navigating to:', page);
    win.loadFile(path.join(__dirname, `../public/${page}`));
  }
});

app.on('before-quit', async () => {
  try { stopKeepAlive(); } catch (_) {}
  try { await stopOllama({ log: true }); } catch (_) {}
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    try { stopKeepAlive(); } catch (_) {}
    try { await stopOllama({ log: true }); } catch (_) {}
    app.quit();
  }
});
