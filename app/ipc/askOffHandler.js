// app/ipc/askOffHandler.js
const { ipcMain } = require('electron');
const { allAsync } = require('../database/db'); // ⬅️ switched from getAsync to allAsync
const axios = require('axios');
const { decodeToken } = require('../model/userModel');

const SLM_URL = process.env.SLM_API || 'http://127.0.0.1:11434/v1/completions';
const SLM_MODEL = process.env.SLM_MODEL || 'granite3.2:2b';

function categoryPrompt(category) {
  switch ((category || '').toLowerCase()) {
    case 'medical':
      return 'Extract only the medical information: conditions, allergies, medications, and any hospitalizations. Do not add extra commentary.';
    case 'profile':
      return 'Summarize only the person’s profile including full name, DOB, location, occupation, and education. Do not add any introductory phrases.';
    case 'timeline':
      return 'List only important life events in chronological order with approximate dates. Do not add extra words.';
    case 'relationships':
      return 'Describe only the person’s family and social relationships including parents, spouse, children, siblings. Be concise.';
    case 'family-tree':
    case 'family_tree':
      return 'Generate only a family tree in the form A —[relationship]→ B. No extra text.';
    default:
      return 'Answer concisely and directly. Do not explain how you got the information.';
  }
}

// ---------- scope helper (default = 'all') ----------
async function fetchScopedText(userId, scope) {
  const type = scope?.type || 'all';

  if (type === 'latest') {
    const rows = await allAsync(
      `SELECT id, file_name, extracted_text
         FROM records
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [userId]
    );
    const r = rows?.[0];
    if (!r?.extracted_text) return '';
    return `[[${r.file_name || `Record ${r.id}`}]]\n${r.extracted_text}\n`;
  }

  if (type === 'all') {
    const rows = await allAsync(
      `SELECT id, file_name, extracted_text
         FROM records
        WHERE user_id = ?
        ORDER BY id DESC`,
      [userId]
    );
    if (!rows?.length) return '';
    return rows.map(r =>
      `[[${r.file_name || `Record ${r.id}`}]]\n${r.extracted_text || ''}\n`
    ).join('\n-------------------------\n');
  }

  if (type === 'ids') {
    const cleanIds = Array.isArray(scope?.ids)
      ? scope.ids.map(Number).filter(Number.isInteger)
      : [];
    if (!cleanIds.length) return '';
    const placeholders = cleanIds.map(() => '?').join(',');
    const params = [...cleanIds, userId];
    const rows = await allAsync(
      `SELECT id, file_name, extracted_text
         FROM records
        WHERE id IN (${placeholders}) AND user_id = ?
        ORDER BY id DESC`,
      params
    );
    if (!rows?.length) return '';
    return rows.map(r =>
      `[[${r.file_name || `Record ${r.id}`}]]\n${r.extracted_text || ''}\n`
    ).join('\n-------------------------\n');
  }

  return fetchScopedText(userId, { type: 'all' });
}

function clip(text, max = 12000) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

// Category-based structured query (OFFLINE/LOCAL)
ipcMain.handle('ask:off:category', async (_event, { category, token, scope }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };

  try {
    const mergedText = await fetchScopedText(decoded.userId, scope);
    if (!mergedText.trim()) return { success: false, error: 'No document text found' };

    const prompt = `
You are a helpful assistant. Follow these instructions carefully:
${categoryPrompt(category)}

Document text (one or more files):
${clip(mergedText)}

Provide only the requested information as your final answer. Do not say things like "based on the document" or give explanations.
`;

    const response = await axios.post(
      SLM_URL,
      {
        model: SLM_MODEL,
        prompt,
        stream: false,
        temperature: 0.3,
        top_p: 0.9,
        max_tokens: 1024
      },
      { timeout: 600000 }
    );

    const answer = response.data?.choices?.[0]?.text?.trim() || 'No answer returned.';
    return { success: true, answer };
  } catch (err) {
    console.error('SLM (offline) category error:', err.message);
    return { success: false, error: 'Failed to contact SLM.' };
  }
});

// User freeform question (OFFLINE/LOCAL)
ipcMain.handle('ask:off:question', async (_event, { question, token, scope }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };

  try {
    const mergedText = await fetchScopedText(decoded.userId, scope);
    if (!mergedText.trim()) return { success: false, error: 'No document text found' };

    const prompt = `
You are a helpful assistant. The user asks:
"${question}"

Answer using only the information from this document text (one or more files).
If multiple files are present, reconcile conflicts sensibly:
${clip(mergedText)}

Provide a direct answer only. Do not say "based on the document" or give extra commentary.
`;

    const response = await axios.post(
      SLM_URL,
      {
        model: SLM_MODEL,
        prompt,
        stream: false,
        temperature: 0.3,
        top_p: 0.9,
        max_tokens: 1024
      },
      { timeout: 600000 }
    );

    const answer = response.data?.choices?.[0]?.text?.trim() || 'No answer returned.';
    return { success: true, answer };
  } catch (err) {
    console.error('SLM (offline) Q&A error:', err.message);
    return { success: false, error: 'Failed to contact SLM.' };
  }
});
