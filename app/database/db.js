const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

const dbDirectory = app.getPath('userData');
const dbPath = path.join(dbDirectory, 'family.db');

if (!fs.existsSync(dbDirectory)) {
  fs.mkdirSync(dbDirectory, { recursive: true });
}

const db = new Database(dbPath);
console.log('Connected to SQLite DB at:', dbPath);

// Ensure tables exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`).run();

// NOTE: includes file_name, topic, file_path for fresh installs
db.prepare(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    extracted_text TEXT NOT NULL,
    extracted_json TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    file_name TEXT,
    topic TEXT,
    file_path TEXT
  )
`).run();

// Migration: add file_name if missing (records)
try {
  const cols = db.prepare(`PRAGMA table_info(records)`).all();
  const hasFileName = cols.some(c => c.name === 'file_name');
  if (!hasFileName) {
    db.prepare(`ALTER TABLE records ADD COLUMN file_name TEXT`).run();
    console.log('✅ Added file_name column to records table');
  }
} catch (e) {
  console.warn('⚠️ Could not add file_name column:', e.message);
}

// Migration: add topic if missing (records)
try {
  const cols2 = db.prepare(`PRAGMA table_info(records)`).all();
  const hasTopic = cols2.some(c => c.name === 'topic');
  if (!hasTopic) {
    db.prepare(`ALTER TABLE records ADD COLUMN topic TEXT`).run();
    console.log('✅ Added topic column to records table');
  }
} catch (e) {
  console.warn('⚠️ Could not add topic column:', e.message);
}

// Migration: add file_path if missing (records)
try {
  const cols3 = db.prepare(`PRAGMA table_info(records)`).all();
  const hasFilePath = cols3.some(c => c.name === 'file_path');
  if (!hasFilePath) {
    db.prepare(`ALTER TABLE records ADD COLUMN file_path TEXT`).run();
    console.log('✅ Added file_path column to records table');
  }
} catch (e) {
  console.warn('⚠️ Could not add file_path column:', e.message);
}

// --- Users table migrations: add profile fields if missing
try {
  const userCols = db.prepare(`PRAGMA table_info(users)`).all();
  const ensureCol = (name, sqlType) => {
    if (!userCols.some(c => c.name === name)) {
      db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${sqlType}`).run();
      console.log(`✅ Added ${name} column to users table`);
    }
  };
  ensureCol('name', 'TEXT');
  ensureCol('phone', 'TEXT');
  ensureCol('age', 'INTEGER');
  ensureCol('dob', 'TEXT');                // ISO 'YYYY-MM-DD'
  ensureCol('gender', 'TEXT');             // e.g. 'male','female','other','prefer_not_to_say'
  ensureCol('profile_photo_path', 'TEXT'); // local path in userData
  ensureCol('address', 'TEXT');            // optional address used by UI
} catch (e) {
  console.warn('⚠️ Could not migrate users table:', e.message);
}

// Promisified helpers for async/await
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(sql);
      const row = stmt.get(params);
      resolve(row);
    } catch (err) {
      reject(err);
    }
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all(params);
      resolve(rows);
    } catch (err) {
      reject(err);
    }
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(sql);
      const info = stmt.run(params);
      resolve(info);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { db, getAsync, allAsync, runAsync };
