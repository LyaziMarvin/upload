// insertToDatabase.js
const { runAsync } = require('./database/db');

/**
 * Inserts a new record into the database.
 * Now supports storing file_path for deletion & replacement logic.
 *
 * @param {{ text: string, summary: string, filePath?: string }} data
 * @param {number} userId
 * @returns {Promise<number>} inserted record ID
 */
async function insertRecord(data, userId) {
  const result = await runAsync(
    `INSERT INTO records (user_id, extracted_text, extracted_json, file_path)
     VALUES (?, ?, ?, ?)`,
    [
      userId,
      data.text || '',
      data.summary || '{}',
      data.filePath || null
    ]
  );

  // Last inserted row id
  const lastId = result?.lastInsertRowid || null;
  return lastId;
}

module.exports = { insertRecord };
