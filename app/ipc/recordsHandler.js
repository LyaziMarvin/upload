// app/ipc/recordsHandler.js
const { ipcMain } = require('electron');
const axios = require('axios');
const fs = require('fs');
const { getAsync, allAsync, runAsync } = require('../database/db');
const { decodeToken } = require('../model/userModel');

// -------------------- Config for SLM (Granite) --------------------
const SLM_URL = process.env.SLM_URL || 'http://208.109.228.76:11435/api/generate';
const SLM_MODEL = process.env.SLM_MODEL || 'granite3.2:2b';

function genOptions() {
  return {
    max_tokens: 256,
    temperature: 0.2,
    top_p: 0.9,
    options: {
      num_predict: 256,
      temperature: 0.2,
      top_p: 0.9,
      repeat_penalty: 1.25,
      presence_penalty: 0.2,
      frequency_penalty: 0.2,
      stop: ["\n\nCONTEXT:", "\n\nQUESTION:", "\n\nAnswer:", "\n\nContext:"]
    }
  };
}

async function askGranite(prompt, { timeout = 600000 } = {}) {
  const body = { model: SLM_MODEL, prompt, stream: false, ...genOptions() };
  const response = await axios.post(SLM_URL, body, { timeout });
  const raw = response.data;
  if (typeof raw === 'string') {
    const lines = raw.split('\n');
    let answer = '';
    for (const ln of lines) {
      try {
        const obj = JSON.parse(ln);
        if (obj.response) answer += obj.response;
        if (obj.done) break;
      } catch (_) {}
    }
    if (answer) return answer.trim();
  }
  if (Array.isArray(raw)) return raw.join('\n');
  if (raw?.response) return raw.response;
  return String(raw || '');
}

function normalizeTopic(s) {
  if (!s) return null;
  let t = String(s).trim();
  t = t.replace(/^\s*(topic:|main topic:)\s*/i, '').trim();
  t = t.replace(/[\s\.\!\?]+$/,'').trim();
  t = t.replace(/\s+/g, ' ').slice(0, 120);
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t || null;
}

function safeErr(e) {
  if (e?.response?.data) {
    try { return JSON.stringify(e.response.data); } catch {}
  }
  return e?.message || String(e);
}

// -------------------------
// Get all records
// -------------------------
ipcMain.handle('records:get-all', async (_event, token) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };

  try {
    const rows = await allAsync(
      `SELECT id, file_name, uploaded_at, topic
       FROM records
       WHERE user_id = ?
       ORDER BY uploaded_at DESC, id DESC`,
      [decoded.userId]
    );

    return { success: true, data: rows || [] };
  } catch (err) {
    console.error('❌ Failed to fetch records:', err.message);
    return { success: false, error: 'Failed to fetch records' };
  }
});

// -------------------------
// Get one record by ID
// -------------------------
ipcMain.handle('records:get-one', async (_event, { id, token }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };

  try {
    const row = await getAsync(
      `SELECT id, file_name, uploaded_at, topic, extracted_text, extracted_json
       FROM records
       WHERE id = ? AND user_id = ?`,
      [id, decoded.userId]
    );

    if (!row) return { success: false, error: 'Record not found' };

    return {
      success: true,
      data: {
        ...row,
        summary: null
      }
    };
  } catch (err) {
    console.error('❌ Failed to fetch record by ID:', err.message);
    return { success: false, error: 'Failed to fetch record' };
  }
});

// -------------------------
// Delete one record by ID (and its file)
// -------------------------
ipcMain.handle('records:delete', async (_event, { id, token }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };
  if (!id || isNaN(Number(id))) return { success: false, error: 'Invalid record id' };

  try {
    // 1) Find the record so we know its file_path
    const row = await getAsync(
      `SELECT file_path FROM records WHERE id = ? AND user_id = ?`,
      [id, decoded.userId]
    );

    if (!row) return { success: false, error: 'Record not found' };

    // 2) Delete the file from disk (best-effort)
    if (row.file_path && fs.existsSync(row.file_path)) {
      try {
        fs.unlinkSync(row.file_path);
      } catch (e) {
        console.warn('⚠️ Failed to remove file on delete:', e.message);
      }
    }

    // 3) Delete the DB row
    const info = await runAsync(
      `DELETE FROM records WHERE id = ? AND user_id = ?`,
      [id, decoded.userId]
    );
    if ((info?.changes || 0) > 0) {
      return { success: true };
    } else {
      return { success: false, error: 'Record not found' };
    }
  } catch (err) {
    console.error('❌ Failed to delete record:', err.message);
    return { success: false, error: 'Failed to delete record' };
  }
});

// -------------------------
// Bulk delete by IDs (and their files)
// -------------------------
ipcMain.handle('records:delete-many', async (_event, { ids, token }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, error: 'No record ids provided' };
  }

  const cleanIds = ids.map(Number).filter(Number.isInteger);
  if (cleanIds.length === 0) return { success: false, error: 'Invalid record ids' };

  const placeholders = cleanIds.map(() => '?').join(',');
  const params = [...cleanIds, decoded.userId];

  try {
    // 1) Get file paths
    const rows = await allAsync(
      `SELECT file_path
         FROM records
        WHERE id IN (${placeholders}) AND user_id = ?`,
      params
    );

    // 2) Delete files from disk (best-effort)
    for (const row of rows || []) {
      if (row.file_path && fs.existsSync(row.file_path)) {
        try {
          fs.unlinkSync(row.file_path);
        } catch (e) {
          console.warn('⚠️ Failed to remove file on bulk delete:', e.message);
        }
      }
    }

    // 3) Delete DB rows
    const info = await runAsync(
      `DELETE FROM records WHERE id IN (${placeholders}) AND user_id = ?`,
      params
    );
    return { success: true, deleted: info?.changes || 0 };
  } catch (err) {
    console.error('❌ Failed bulk delete:', err.message);
    return { success: false, error: 'Failed to delete records' };
  }
});

// -------------------------
// Regenerate topic (single)
// -------------------------
ipcMain.handle('records:regenerate-topic', async (_event, { id, token }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };
  if (!id || isNaN(Number(id))) return { success: false, error: 'Invalid record id' };

  try {
    const row = await getAsync(
      `SELECT extracted_text FROM records WHERE id = ? AND user_id = ?`,
      [id, decoded.userId]
    );
    if (!row) return { success: false, error: 'Record not found' };

    const text = (row.extracted_text || '').trim();
    if (!text) return { success: false, error: 'No extracted text to analyze' };

    const excerpt = text.slice(0, 6000);
    const prompt = `From the document excerpt below, produce a short, human-friendly topic (max ~7 words). Respond with just the topic.\n\n=== DOCUMENT EXCERPT ===\n${excerpt}\n\n=== END ===\n\nTopic:`;

    const raw = await askGranite(prompt);
    const topic = normalizeTopic(raw);
    if (!topic) return { success: false, error: 'Topic generation returned empty' };

    await runAsync(`UPDATE records SET topic = ? WHERE id = ? AND user_id = ?`, [topic, id, decoded.userId]);

    return { success: true, data: { id, topic } };
  } catch (e) {
    console.error('❌ Regenerate topic failed:', safeErr(e));
    return { success: false, error: 'Failed to regenerate topic' };
  }
});
