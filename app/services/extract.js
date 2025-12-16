// app/services/extract.js
const fs = require('fs');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { insertRecord } = require('../insertToDatabase');

/**
 * Extracts plaintext from a file and stores it in the DB.
 * Returns the inserted record ID.
 *
 * @param {string} filePath
 * @param {string} mimetype
 * @param {number} userId
 * @returns {Promise<number>} inserted record id
 */
module.exports = async function extractFamilyDataFromFile(filePath, mimetype, userId) {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    let text = '';
    if (mimetype === 'application/pdf') {
      const pdfData = await pdfParse(fileBuffer);
      text = (pdfData.text || '').trim();
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      text = (result.value || '').trim();
    } else if (mimetype === 'text/plain') {
      text = fileBuffer.toString('utf-8').trim();
    } else {
      throw new Error('Unsupported file type for text extraction.');
    }

    const summary = {
      wordCount: text ? text.split(/\s+/).length : 0,
      preview: (text || '').slice(0, 200) + (text && text.length > 200 ? '...' : ''),
    };

    // Store extracted text + summary + file_path
    const id = await insertRecord(
      { text, summary: JSON.stringify(summary), filePath },
      userId
    );
    return id;
  } catch (error) {
    console.error('❌ Failed to extract data:', error.message);
    throw error;
  }
};
