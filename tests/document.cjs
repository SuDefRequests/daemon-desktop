const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createDocument, validateDocx } = require("../electron/document.cjs");
const { writeArtifact } = require("../electron/artifact-files.cjs");
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidur-word-"));
  const content =
    "# Virat Kohli\n\nActual fixture text from the model: retain this content.\n- A < B & C\n\n## Review\nReview factual details before use.";
  const artifact = { name: "virat_kohli.docx", kind: "document", content };
  const saved = await writeArtifact(directory, artifact);
  const bytes = await fs.readFile(saved.path);
  const zip = await validateDocx(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  assert.ok(xml.includes("Virat Kohli"));
  assert.ok(
    xml.includes("Actual fixture text from the model: retain this content."),
  );
  assert.ok(xml.includes("A &lt; B &amp; C"));
  assert.ok(xml.includes("Heading1") && xml.includes("Heading2"));
  assert.equal(saved.content, content);
  const duplicates = await Promise.all([
    writeArtifact(directory, artifact),
    writeArtifact(directory, artifact),
  ]);
  assert.deepEqual(duplicates.map((a) => a.name).sort(), [
    "virat_kohli_2.docx",
    "virat_kohli_3.docx",
  ]);
  assert.deepEqual(await fs.readFile(saved.path), bytes);
  for (const a of duplicates) await validateDocx(await fs.readFile(a.path));
  const before = await fs.readdir(directory);
  for (const invalid of [
    "",
    "   ",
    "Error: AI timed out.",
    "{}",
    "```python\nprint(1)\n```",
    "bad\u0000text",
    "bad\ud800text",
    "x".repeat(100001),
  ])
    await assert.rejects(
      writeArtifact(directory, { ...artifact, content: invalid }),
    );
  const { Packer } = require("docx");
  const pack = Packer.toBuffer;
  try {
    Packer.toBuffer = async () => Buffer.from("fake docx");
    await assert.rejects(writeArtifact(directory, artifact));
  } finally {
    Packer.toBuffer = pack;
  }
  assert.deepEqual(await fs.readdir(directory), before);
  await assert.rejects(validateDocx(Buffer.from("plain text")));
  const plain = await validateDocx(
    await createDocument("Partial but usable model paragraph"),
  );
  assert.ok(
    (await plain.file("word/document.xml").async("string")).includes(
      "Partial but usable model paragraph",
    ),
  );
  console.log(
    `Word: OOXML/ZIP validity, actual source content, headings, bullets, previews, concurrent collisions, partial text and invalid/failed generation passed. Sample: ${saved.path}`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
