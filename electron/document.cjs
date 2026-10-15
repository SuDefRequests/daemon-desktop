const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
const JSZip = require("jszip");

function documentParagraphs(content) {
  if (
    typeof content !== "string" ||
    !content.trim() ||
    !content.isWellFormed() ||
    content.length > 100_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(content)
  )
    throw new Error(
      "Invalid or empty document content. No Word file was created.",
    );
  let text = content.trim();
  if (/^error\s*:/i.test(text)) throw new Error(text);
  if (/^```/.test(text)) {
    if (!/^```(?:text|markdown|md)?\s*\r?\n/i.test(text))
      throw new Error(
        "Unsupported document format; expected text or Markdown.",
      );
    text = text.replace(/^```[^\n]*\n/, "").replace(/\n```\s*$/, "");
  }
  if (!/[\p{L}\p{N}]/u.test(text) || /^\{/.test(text))
    throw new Error("No usable document content. No Word file was created.");
  return text.split(/\r?\n/).map((line) => {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+•]\s+(.+)$/);
    return new Paragraph({
      ...(heading
        ? { heading: HeadingLevel[`HEADING_${heading[1].length}`] }
        : {}),
      ...(bullet ? { bullet: { level: 0 } } : {}),
      children: [new TextRun(heading ? heading[2] : bullet ? bullet[1] : line)],
      spacing: { after: 160, line: 276 },
    });
  });
}

async function validateDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
  ]) {
    if (!zip.file(name)) throw new Error("Word package validation failed.");
  }
  const types = await zip.file("[Content_Types].xml").async("string");
  if (
    !types.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    )
  )
    throw new Error("Word package has an invalid content type.");
  return zip;
}

async function createDocument(content) {
  const document = new Document({
    creator: "VIDUR AI",
    styles: { default: { document: { run: { font: "Aptos", size: 24 } } } },
    sections: [{ children: documentParagraphs(content) }],
  });
  const buffer = await Packer.toBuffer(document);
  await validateDocx(buffer);
  return buffer;
}
module.exports = { createDocument, documentParagraphs, validateDocx };
