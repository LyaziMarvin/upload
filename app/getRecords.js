// getRecords.js
const { allAsync, getAsync } = require('./database/db.js');

async function getAllRecords() {
  const rows = await allAsync('SELECT id, full_name FROM records');
  return rows;
}

async function getRecordById(id) {
  const row = await getAsync('SELECT json FROM records WHERE id = ?', [id]);
  return row ? JSON.parse(row.json) : null;
}

module.exports = { getAllRecords, getRecordById };
