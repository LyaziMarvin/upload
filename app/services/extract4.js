// --- extract.js ---
const fs = require('fs');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { insertRecord } = require('../insertToDatabase');

function cleanText(raw) {
  return raw
    .normalize('NFKC')                 // normalize unicode to a consistent form
    .replace(/\u00A0/g, ' ')           // non-breaking spaces → normal
    .replace(/[ﬁﬂ]/g, m => (m === 'ﬁ' ? 'fi' : 'fl')) // fix ligatures
    .replace(/[ \t]+/g, ' ')           // collapse multiple spaces
    .replace(/\r?\n{2,}/g, '\n\n')     // keep real paragraphs (2+ newlines)
    .replace(/\r?\n/g, ' ')            // single newlines → spaces
    .trim();
}

module.exports = async function extractFamilyDataFromFile(filePath, mimetype, userId) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    let text = "";

    if (mimetype === "application/pdf") {
      const pdfData = await pdfParse(fileBuffer);
      text = pdfData.text;
    } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      text = result.value;
    } else {
      throw new Error("Unsupported file type for text extraction.");
    }

    // Clean and normalize the extracted text
    const cleanedText = cleanText(text);

    const summary = {
      wordCount: cleanedText.split(/\s+/).length,
      preview: cleanedText.slice(0, 200) + '...'
    };

    // Store in database as plain UTF-8 text (ready for tokenization)
    insertRecord({ 
      text: cleanedText, 
      summary: JSON.stringify(summary),
      mimetype,
      sourceFile: filePath
    }, userId);

    // Also return an object useful for exporting to JSONL later
    return {
      userId,
      text: cleanedText,
      wordCount: summary.wordCount
    };
  } catch (error) {
    console.error("❌ Failed to extract data:", error.message);
    throw error;
  }
};
