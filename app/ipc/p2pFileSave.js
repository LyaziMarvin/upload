//p2pFileSave.js
const { ipcMain, dialog } = require('electron');
const { writeFile } = require('fs/promises');

ipcMain.handle('p2p:save-file', async (_evt, { name, data }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: name || 'received.bin' });
  if (canceled || !filePath) return { saved: false };
  await writeFile(filePath, Buffer.from(data));
  return { saved: true, path: filePath };
});
