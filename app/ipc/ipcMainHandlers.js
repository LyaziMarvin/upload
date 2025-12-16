const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const userModel = require('../model/userModel');
const { ensureStarted, stop: stopOllama } = require('./ollamaProcess');

// AUTH
ipcMain.handle('auth:register', async (_event, { email, password }) => {
  try {
    await userModel.registerUser({ email, password });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth:login', async (_event, { email, password }) => {
  try {
    const token = await userModel.validateLogin({ email, password });
    await ensureStarted({ log: true });
    return { success: true, token };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// NEW: decode-token passthrough so renderer can validate session
ipcMain.handle('auth:decode-token', async (_event, token) => {
  try {
    const decoded = userModel.decodeToken(token);
    return decoded ? { success: true, data: decoded } : { success: false, error: 'Invalid token' };
  } catch {
    return { success: false, error: 'Invalid token' };
  }
});

ipcMain.handle('auth:get-current-user', async (_event, token) => {
  try {
    const user = await userModel.getCurrentUser(token);
    return user ? { success: true, data: user } : { success: false, error: 'Not authenticated' };
  } catch {
    return { success: false, error: 'Failed to get current user' };
  }
});

ipcMain.handle('auth:logout', async () => {
  await stopOllama({ log: true });
  return { success: true };
});

// PROFILE
function saveProfilePhotoToAppData(userId, sourcePath) {
  if (!sourcePath) return null;
  try {
    const imgDir = path.join(app.getPath('userData'), 'profile_photos');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    const ext = path.extname(sourcePath) || '.jpg';
    const dest = path.join(imgDir, `user_${userId}${ext}`);
    fs.copyFileSync(sourcePath, dest);
    return dest;
  } catch {
    return null;
  }
}

ipcMain.handle('auth:update-profile', async (_event, { token, profile }) => {
  try {
    const user = await userModel.getCurrentUser(token);
    if (!user) return { success: false, error: 'Not authenticated' };

    let profile_photo_path = user.profile_photo_path || null;
    if (profile?.photoPath) {
      const saved = saveProfilePhotoToAppData(user.id, profile.photoPath);
      if (saved) profile_photo_path = saved;
    }

    const fresh = await userModel.updateProfile(user.id, {
      email: profile?.email,
      name: profile?.name,
      phone: profile?.phone,
      age: profile?.age,
      dob: profile?.dob,
      gender: profile?.gender,
      profile_photo_path
    });

    return { success: true, data: fresh };
  } catch {
    return { success: false, error: 'Failed to update profile' };
  }
});

// OTHER HANDLERS
require('./uploadHandler');
require('./recordsHandler');
require('./askOnHandler');
require('./askOffHandler');
require('./ollamaHandler');

// NEW: P2P File Save
require('./p2pFileSave');
