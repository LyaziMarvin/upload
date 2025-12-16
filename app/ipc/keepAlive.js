// app/ipc/keepAlive.js
const axios = require('axios');

// Granite generate endpoint (Ollama-compatible) + model
const SLM_URL = process.env.SLM_URL || 'http://208.109.228.76:11435/api/generate';
const SLM_MODEL = process.env.SLM_MODEL || 'granite3.2:2b';

// Ollama embeddings endpoint + model
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://208.109.228.76:11435';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'all-minilm';

// How often to ping (default 1h30m). Adjust if your host idles sooner.
const KEEP_ALIVE_MS = Number(process.env.KEEP_ALIVE_MS || (90 * 60 * 1000));

let intervalId = null;

async function pingGranite() {
  try {
    await axios.post(
      SLM_URL,
      {
        model: SLM_MODEL,
        prompt: 'ping',
        stream: false,
        max_tokens: 1,
        options: {
          num_predict: 1
        }
      },
      { timeout: 20000 }
    );
    console.log('✅ Granite keep-alive ok');
  } catch (e) {
    console.warn('❌ Granite keep-alive failed:', e.message || e);
  }
}

async function pingEmbeddings() {
  try {
    await axios.post(
      `${OLLAMA_URL}/api/embeddings`,
      { model: OLLAMA_EMBED_MODEL, prompt: 'ok' },
      { timeout: 20000 }
    );
    console.log('✅ Embeddings keep-alive ok');
  } catch (e) {
    console.warn('❌ Embeddings keep-alive failed:', e.message || e);
  }
}

function startKeepAlive() {
  if (intervalId) return; // already running
  // Warm immediately on start
  pingGranite();
  pingEmbeddings();

  intervalId = setInterval(() => {
    pingGranite();
    pingEmbeddings();
  }, KEEP_ALIVE_MS);

  console.log(`🔄 Keep-alive started (every ${Math.round(KEEP_ALIVE_MS / 60000)} min)`);
}

function stopKeepAlive() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('🛑 Keep-alive stopped');
  }
}

module.exports = { startKeepAlive, stopKeepAlive };
