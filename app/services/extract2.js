// --- extract.js ---
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { insertRecord } = require('../insertToDatabase');

module.exports = async function extractFamilyDataFromFile(filePath, mimetype, userId) {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    let text = "";
    if (mimetype === "application/pdf") {
      const pdfData = await pdfParse(fileBuffer);
      text = pdfData.text.trim();
      console.log(text)
    } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      
      text = result.value.trim();
      
    } else {
      throw new Error("Unsupported file type for text extraction.");
    }

    const summary = {
      wordCount: text.split(/\s+/).length,
      preview: text.slice(0, 200) + '...'
    };
     
    
    insertRecord({ text, summary: JSON.stringify(summary) }, userId);
    return true;
  } catch (error) {
    console.error("❌ Failed to extract data:", error.message);
    throw error;
  }
};
