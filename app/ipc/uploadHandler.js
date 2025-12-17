// app/ipc/uploadHandler.js
const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const extractFamilyDataFromFile = require('../services/extract');
const { decodeToken } = require('../model/userModel');
const { runAsync, getAsync, allAsync } = require('../database/db');

// ---------------- Config ----------------
const SLM_URL = process.env.SLM_URL || 'http://208.109.228.76:11435/api/generate';
const SLM_MODEL = process.env.SLM_MODEL || 'granite3.2:2b';
const OLLAMA_EMBED_URL = process.env.OLLAMA_EMBED_URL || 'http://208.109.228.76:11435/api/embeddings';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'all-minilm';

// Limits for chunking and token -> char ratio (heuristic)
const LINES_PER_CHUNK = 120;
const LINES_OVERLAP = 20;
const MAX_TOKENS_PER_CHUNK = 2000;
const TOKEN_CHAR_RATIO = 4; // approx chars per token

const DEBUG = !!process.env.DEBUG;

// ---------------- Helpers ----------------
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function uniqueDestPath(destDir, originalName) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(destDir, `${base}__${stamp}${ext}`);
}

function getMimeType(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.txt')) return 'text/plain';
  // AUDIO
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  // IMAGES
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function getAppUserFolder(baseKey, userId) {
  const basePath = app.getPath(baseKey); // 'documents', 'pictures', 'music'
  const target = path.join(basePath, 'Kin-Keepers', 'Family-Circle', `my-data-${userId}`);
  ensureDir(target);
  return target;
}

function chunkByLines(text, linesPerChunk = LINES_PER_CHUNK, overlap = LINES_OVERLAP) {
  const lines = String(text || '').split(/\r?\n/);
  const chunks = [];
  for (let i = 0; i < lines.length; i += (linesPerChunk - overlap)) {
    const part = lines.slice(i, i + linesPerChunk).join('\n');
    if (part.trim()) chunks.push(part);
  }
  return chunks;
}

function splitDocumentIntoCharChunks(
  text,
  maxTokensPerChunk = MAX_TOKENS_PER_CHUNK,
  ratio = TOKEN_CHAR_RATIO
) {
  const maxChars = maxTokensPerChunk * ratio;
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    if (end >= text.length) end = text.length;
    else {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0)) || 1;
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0)) || 1;
  return dot / (magA * magB);
}

function safeMsg(e) {
  if (e?.response?.data) try { return JSON.stringify(e.response.data); } catch (_) { }
  return e?.message || String(e);
}

// Normalize a short, human-friendly topic
function normalizeTopic(s) {
  if (!s) return null;
  let t = String(s).trim();
  t = t.replace(/^\s*(topic:|main topic:)\s*/i, '').trim();
  t = t.replace(/[\s\.\!\?]+$/, '').trim();
  t = t.replace(/\s+/g, ' ').slice(0, 120);
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t || null;
}

// ---------- Embeddings (Transformers) ----------
let _embedderPromise = null;

async function embedOne(text) {
  try {
    const response = await axios.post(OLLAMA_EMBED_URL, {
      model: OLLAMA_EMBED_MODEL,
      prompt: String(text || '')
    });
    return response.data.embedding;
  } catch (error) {
    console.error('Ollama embedding error:', error.message);
    throw new Error('Failed to generate embedding with Ollama');
  }
}

// ---------------- Granite (SLM) helper ----------------
function genOptions() {
  return {
    max_tokens: 512,
    temperature: 0.2,
    top_p: 0.9,
    options: {
      num_predict: 512,
      temperature: 0.2,
      top_p: 0.9,
      repeat_penalty: 1.25,
      presence_penalty: 0.2,
      frequency_penalty: 0.2,
      stop: ["\n\nCONTEXT:", "\n\nQUESTION:", "\n\nAnswer:", "\n\nContext:"]
    }
  };
}

async function askGranite(prompt, { stream = false, timeout = 600000 } = {}) {
  const body = {
    model: SLM_MODEL,
    prompt,
    stream,
    ...genOptions(),
  };

  if (stream) {
    const resp = await axios.post(SLM_URL, body, { responseType: 'stream', timeout });
    return resp;
  } else {
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
        } catch (_) { }
      }
      if (answer) return answer.trim();
    }
    if (Array.isArray(response.data)) return response.data.join('\n');
    if (response.data?.response) return response.data.response;
    return String(response.data || '');
  }
}

// ---------------- IPC: Upload ----------------
/**
 * upload: files
 * payload: { docPath, photoPaths, musicPaths, token }
 * returns: { success, data: { docSavedTo, fileName, recordId, autoAnswer, topic } }
 */
ipcMain.handle('upload:files', async (_event, { docPath, photoPaths, musicPaths, token }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };
  const userId = decoded.userId;

  try {
    let savedDocPath = null;
    let originalDocName = null;
    let recordId = null;

    // ---------------- Documents ----------------
    if (docPath && fs.existsSync(docPath)) {
      const userDocsFolder = getAppUserFolder('documents', userId);
      originalDocName = path.basename(docPath);

      // 1) If a record already exists with this filename for this user,
      //    delete its DB row AND its physical file before proceeding.
      try {
        const existing = await getAsync(
          `SELECT id, file_path
             FROM records
            WHERE user_id = ? AND LOWER(file_name) = LOWER(?)
            ORDER BY uploaded_at DESC, id DESC
            LIMIT 1`,
          [userId, originalDocName]
        );

        if (existing) {
          if (existing.file_path && fs.existsSync(existing.file_path)) {
            try {
              fs.unlinkSync(existing.file_path);
            } catch (e) {
              console.warn('⚠️ Failed to remove old file on replace:', e.message);
            }
          }

          await runAsync(
            `DELETE FROM records WHERE id = ? AND user_id = ?`,
            [existing.id, userId]
          );
        }
      } catch (e) {
        console.warn('⚠️ Error checking existing record on upload:', e.message);
      }

      // 2) Save new file
      const destDocPath = uniqueDestPath(userDocsFolder, originalDocName);
      fs.copyFileSync(docPath, destDocPath);
      savedDocPath = destDocPath;

      // 3) Extract to DB (returns inserted record id, stores file_path inside)
      recordId = await extractFamilyDataFromFile(destDocPath, getMimeType(destDocPath), userId);

      // 4) Update filename + timestamp for that record
      await runAsync(
        `UPDATE records
           SET file_name = ?, uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
         WHERE user_id = ? AND id = ?`,
        [originalDocName, userId, recordId]
      );
    }

    // ---------------- Photos ----------------
    if (Array.isArray(photoPaths)) {
      const userPicsFolder = getAppUserFolder('pictures', userId);
      for (const photo of photoPaths) {
        if (!photo || !fs.existsSync(photo)) continue;
        const destPhotoPath = uniqueDestPath(userPicsFolder, path.basename(photo));
        fs.copyFileSync(photo, destPhotoPath);
      }
    }

    // ---------------- Music ----------------
    if (Array.isArray(musicPaths)) {
      const userMusicFolder = getAppUserFolder('music', userId);
      for (const music of musicPaths) {
        if (!music || !fs.existsSync(music)) continue;
        const destMusicPath = uniqueDestPath(userMusicFolder, path.basename(music));
        fs.copyFileSync(music, destMusicPath);
      }
    }

    if (!savedDocPath && (!photoPaths?.length && !musicPaths?.length)) {
      return { success: false, error: 'No files selected.' };
    }

    // ---------------- Auto-query on uploaded record ----------------
    let autoAnswer = null;
    let topicNormalized = null;

    if (recordId) {
      try {
        // fetch the extracted_text for that record
        const row = await getAsync(
          `SELECT extracted_text, file_name FROM records WHERE id = ? AND user_id = ?`,
          [recordId, userId]
        );
        const text = row?.extracted_text || '';
        const fileName = row?.file_name || originalDocName || `Record ${recordId}`;

        if (text && text.trim()) {
          // chunk the text reasonably
          let chunks = chunkByLines(text, LINES_PER_CHUNK, LINES_OVERLAP);
          if (!chunks || !chunks.length) chunks = splitDocumentIntoCharChunks(text, MAX_TOKENS_PER_CHUNK);

          // embed chunks (best-effort; skip chunks that fail to embed)
          const chunkEmbeddings = [];
          for (let i = 0; i < chunks.length; i++) {
            try {
              const emb = await embedOne(chunks[i]);
              chunkEmbeddings.push({ index: i, emb });
            } catch (e) {
              if (DEBUG) console.warn(`Embedding chunk ${i} failed:`, safeMsg(e));
              chunkEmbeddings.push({ index: i, emb: null });
            }
          }

          // embed the question
          const question = 'What is the main topic of this document?';
          let qEmb = null;
          try {
            qEmb = await embedOne(question);
          } catch (e) {
            if (DEBUG) console.warn('Embedding question failed:', safeMsg(e));
            qEmb = null;
          }

          if (qEmb) {
            // score chunks by cosine similarity (skip null embeddings)
            const scored = [];
            for (const c of chunkEmbeddings) {
              if (!c.emb) continue;
              const score = cosineSimilarity(qEmb, c.emb);
              scored.push({ index: c.index, score });
            }

            if (scored.length) {
              scored.sort((a, b) => b.score - a.score);
              const topK = Math.min(2, scored.length);
              const topChunks = scored.slice(0, topK).map(s => chunks[s.index]);
              const context = topChunks.join('\n---\n');

              // Build prompt
              const prompt = `Answer the question using ONLY this context:\n${context}\n\nQuestion: ${question}\n\nAnswer:\n make sure the main topic of any document small or big doesnot exceed 10 words. `;

              // Call Granite (non-streaming)
              try {
                const answerText = await askGranite(prompt, { stream: false });
                autoAnswer = String(answerText || '').trim();
                if (autoAnswer.length > 4000) autoAnswer = autoAnswer.slice(0, 4000);
              } catch (e) {
                if (DEBUG) console.warn('Granite call for auto-summary failed:', safeMsg(e));
                autoAnswer = null;
              }
            }
          }
        }

        // Persist topic if we have it
        topicNormalized = normalizeTopic(autoAnswer);

        // Fallback: single-shot topic over excerpt
        if (!topicNormalized) {
          const raw = (text || '').slice(0, 6000);
          if (raw) {
            try {
              const prompt2 = `From the document excerpt below, produce a short, human-friendly topic (max ~7 words).\n\n=== DOCUMENT EXCERPT ===\n${raw}\n\n=== END ===\n\nTopic:`;
              const ans2 = await askGranite(prompt2, { stream: false });
              topicNormalized = normalizeTopic(ans2);
            } catch (e) {
              if (DEBUG) console.warn('Fallback topic generation failed:', safeMsg(e));
            }
          }
        }

        if (topicNormalized) {
          try {
            await runAsync(
              `UPDATE records SET topic = ? WHERE user_id = ? AND id = ?`,
              [topicNormalized, userId, recordId]
            );
          } catch (e) {
            if (DEBUG) console.warn('Topic update failed:', safeMsg(e));
          }
        }
      } catch (e) {
        if (DEBUG) console.warn('Auto-summary generation error (continuing):', safeMsg(e));
        autoAnswer = null;
      }
    }

    return {
      success: true,
      data: {
        docSavedTo: savedDocPath,
        fileName: originalDocName,
        recordId,
        autoAnswer,
        topic: topicNormalized
      }
    };
  } catch (err) {
    console.error('❌ Upload failed:', err);
    return { success: false, error: err.message || 'Upload failed' };
  }
});

// ----------------- IPC: Photos listing -----------------
ipcMain.handle('photos:get-all', async (_event, token) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };
  const userId = decoded.userId;

  try {
    const userPicsFolder = getAppUserFolder('pictures', userId);
    const files = fs.existsSync(userPicsFolder) ? fs.readdirSync(userPicsFolder) : [];
    const photos = files
      .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f))
      .map(f => path.join(userPicsFolder, f));
    return { success: true, data: photos };
  } catch (err) {
    console.error('❌ Failed to list photos:', err);
    return { success: false, error: err.message };
  }
});

// ----------------- IPC: Music listing -----------------
ipcMain.handle('music:get-all', async (_event, token) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };
  const userId = decoded.userId;

  try {
    const userMusicFolder = getAppUserFolder('music', userId);
    const files = fs.existsSync(userMusicFolder) ? fs.readdirSync(userMusicFolder) : [];
    const tracks = files
      .filter(f => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f))
      .map(f => path.join(userMusicFolder, f));
    return { success: true, data: tracks };
  } catch (err) {
    console.error('❌ Failed to list music:', err);
    return { success: false, error: err.message };
  }
});
