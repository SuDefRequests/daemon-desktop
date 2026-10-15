const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createPresentation,
  presentationSlides,
  validatePptx,
} = require("../electron/presentation.cjs");
const { writeArtifact } = require("../electron/artifact-files.cjs");
const { generate } = require("../electron/inference.cjs");

(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "vidur-powerpoint-"),
  );
  const content =
    '# E-waste management\n\n## Collection\n- Keep electronics out of mixed waste.\n- Use designated collection points.\n\n## Reuse & repair\n- Repair devices when practical.\n- A quoted phrase: "Reuse < replace".\n\n## Recycling\n- Use appropriate recycling services.';
  const artifact = {
    id: "deck",
    kind: "presentation",
    name: "e_waste_management.pptx",
    content,
    presentationStatus: "complete",
  };
  const first = await writeArtifact(directory, artifact);
  const original = await fs.readFile(first.path);
  assert.equal(original.subarray(0, 4).toString("hex"), "504b0304");
  assert.equal(first.content, content); // Source text remains the preview.
  const zip = await validatePptx(original, 4);
  const slides = await Promise.all(
    zip
      .file(/^ppt\/slides\/slide\d+\.xml$/)
      .map((file) => file.async("string")),
  );
  assert.ok(
    slides.some((xml) => xml.includes("Keep electronics out of mixed waste.")),
  );
  assert.ok(
    slides.some((xml) => xml.includes("Repair devices when practical.")),
  );
  assert.ok(slides.some((xml) => xml.includes("Reuse &lt; replace")));
  assert.ok(slides.every((xml) => xml.includes("Model generation finished")));
  assert.ok(
    (
      await zip.file("ppt/notesSlides/notesSlide1.xml").async("string")
    ).includes("E-waste management"),
  );
  const duplicates = await Promise.all([
    writeArtifact(directory, artifact),
    writeArtifact(directory, artifact),
  ]);
  assert.deepEqual(duplicates.map((a) => a.name).sort(), [
    "e_waste_management_2.pptx",
    "e_waste_management_3.pptx",
  ]);
  assert.deepEqual(await fs.readFile(first.path), original);
  for (const saved of duplicates)
    await validatePptx(await fs.readFile(saved.path), 4);

  const prose = Array.from(
    { length: 12 },
    (_, i) => `Returned model sentence ${i + 1}.`,
  ).join(" ");
  assert.ok(presentationSlides(prose).length > 1);
  const plain = await validatePptx(await createPresentation(prose));
  const allText = (
    await Promise.all(
      plain
        .file(/^ppt\/slides\/slide\d+\.xml$/)
        .map((file) => file.async("string")),
    )
  ).join("\n");
  for (let i = 1; i <= 12; i++)
    assert.ok(allText.includes(`Returned model sentence ${i}.`));
  assert.ok(allText.includes("completion status unverified"));
  const partial =
    "Useful content from the model. A second thought that was cut";
  const partialZip = await validatePptx(
    await createPresentation(partial, "partial"),
  );
  const partialXML = await partialZip
    .file("ppt/slides/slide1.xml")
    .async("string");
  assert.ok(partialXML.includes("A second thought that was cut"));
  assert.ok(partialXML.includes("Partial model output"));
  assert.ok(
    presentationSlides("```markdown\n# Returned title\n- Partial bullet")
      .length,
  );
  assert.ok(presentationSlides("[Opening] Welcome to this presentation.").length);
  const long = "Word ".repeat(1000);
  const longSlides = presentationSlides(long);
  assert.ok(
    longSlides.length > 1 && longSlides.every((s) => s.points.length <= 5),
  );
  assert.equal(longSlides.flatMap((s) => s.points).join(" "), long.trim());
  await assert.rejects(
    validatePptx(Buffer.from("plain text disguised as pptx")),
  );
  const before = await fs.readdir(directory);
  const prototype = require("pptxgenjs").prototype;
  const write = prototype.write;
  try {
    prototype.write = async () => {
      throw new Error("Encoder failed");
    };
    await assert.rejects(writeArtifact(directory, artifact), /Encoder failed/);
    prototype.write = async () => Buffer.from("invalid encoder result");
    await assert.rejects(writeArtifact(directory, artifact));
  } finally {
    prototype.write = write;
  }
  for (const invalid of [
    "",
    " \n",
    "---",
    "{}",
    "{broken JSON",
    "```python\nprint(1)\n```",
    "Error: AI timed out.",
    "bad\u0001text",
    "bad\ud800text",
    "x".repeat(100001),
  ]) {
    await assert.rejects(
      writeArtifact(directory, { ...artifact, content: invalid }),
    );
  }
  await assert.rejects(
    writeArtifact(directory, { ...artifact, presentationStatus: "bogus" }),
  );
  assert.deepEqual(await fs.readdir(directory), before);
  await assert.rejects(
    generate("Make a PPT about recycling", {
      timeoutMs: 10,
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          ),
        ),
    }),
    /timed out/,
  );
  assert.deepEqual(await fs.readdir(directory), before);
  console.log(
    `PowerPoint: valid ZIP/OOXML slides, model text, pagination, partial/unknown states, source previews, concurrent collisions and invalid output/timeouts passed. Sample: ${first.path}`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
