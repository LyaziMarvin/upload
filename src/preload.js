// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  register: (credentials) => ipcRenderer.invoke('auth:register', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),
  decodeToken: (token) => ipcRenderer.invoke('auth:decode-token', token),
  getCurrentUser: (token) => ipcRenderer.invoke('auth:get-current-user', token),
  updateUserProfile: (profile, token) => ipcRenderer.invoke('auth:update-profile', { profile, token }),

  uploadFiles: (data) => ipcRenderer.invoke('upload:files', data),

  // Records
  getAllRecords: (token) => ipcRenderer.invoke('records:get-all', token),
  getRecordById: (id, token) => ipcRenderer.invoke('records:get-one', { id, token }),
  deleteRecord: (id, token) => ipcRenderer.invoke('records:delete', { id, token }),
  deleteRecords: (ids, token) => ipcRenderer.invoke('records:delete-many', { ids, token }),

  // NEW: regenerate topic
  regenerateTopic: (id, token) => ipcRenderer.invoke('records:regenerate-topic', { id, token }),

  // Ask / QA
  askQuestionOn: (question, token, scope = { type: 'all' }) =>
    ipcRenderer.invoke('ask:on:question', { question, token, scope, keepAlive: -1 }),
  askQuestionOff: (question, token, scope = { type: 'all' }) => ipcRenderer.invoke('ask:off:question', { question, token, scope }),
  askCategoryOn: (category, token, scope = { type: 'all' }) => ipcRenderer.invoke('ask:on:category', { category, token, scope }),
  askCategoryOff: (category, token, scope = { type: 'all' }) => ipcRenderer.invoke('ask:off:category', { category, token, scope }),

  // Auto / latest
  askAutoOn: (token, question = 'What is the main topic of this document?', currentId = null) => {
    const scope = currentId ? { type: 'current', id: Number(currentId) } : { type: 'latest' };
    return ipcRenderer.invoke('ask:on:auto', { token, scope, question });
  },

  // Media
  getAllPhotos: (token) => ipcRenderer.invoke('photos:get-all', token),
  getAllMusic: (token) => ipcRenderer.invoke('music:get-all', token),

  // Ollama
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  ensureOllamaStarted: () => ipcRenderer.invoke('ollama:ensure-started'),
  stopOllama: () => ipcRenderer.invoke('ollama:stop'),

  // Navigation
  navigateTo: (page) => ipcRenderer.send('navigate-to', page),

  // Streaming
  askStreamStart: ({ question, token, scope, topK = 4 }) => ipcRenderer.send('ask:on:question:stream', { question, token, scope, topK }),
  onAskStreamChunk: (cb) => ipcRenderer.on('ask:on:question:stream:chunk', (_e, data) => cb(data)),
  onAskStreamError: (cb) => ipcRenderer.on('ask:on:question:stream:error', (_e, msg) => cb(msg)),
  removeAskStreamListeners: () => {
    ipcRenderer.removeAllListeners('ask:on:question:stream:chunk');
    ipcRenderer.removeAllListeners('ask:on:question:stream:error');
  },
});

contextBridge.exposeInMainWorld('p2p', {
  saveFile: async (name, uint8) => {
    const res = await ipcRenderer.invoke('p2p:save-file', { name, data: Buffer.from(uint8) });
    return res;
  }
});
