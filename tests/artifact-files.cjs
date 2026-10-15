const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { writeArtifact } = require("../electron/artifact-files.cjs");
(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "daemon-filenames-"),
  );
  await fs.writeFile(
    path.join(directory, "hiking_planner.py"),
    "original file",
  );
  const base = { name: "hiking_planner.py", content: "new sample" };
  const results = await Promise.all([
    writeArtifact(directory, { ...base, id: "first" }),
    writeArtifact(directory, { ...base, id: "second" }),
  ]);
  assert.deepEqual(results.map((a) => a.name).sort(), [
    "hiking_planner_2.py",
    "hiking_planner_3.py",
  ]);
  assert.equal(
    await fs.readFile(path.join(directory, "hiking_planner.py"), "utf8"),
    "original file",
  );
  for (const a of results) {
    assert.equal(path.basename(a.path), a.name);
    assert.equal(await fs.readFile(a.path, "utf8"), base.content);
  }
  await fs.writeFile(
    path.join(directory, "MEETING_NOTES.md"),
    "existing uppercase file",
  );
  const notes = await writeArtifact(directory, {
    id: "notes",
    name: "meeting_notes.md",
    content: "# Notes",
  });
  assert.equal(notes.name, "meeting_notes_2.md");
  assert.equal(
    await fs.readFile(path.join(directory, "MEETING_NOTES.md"), "utf8"),
    "existing uppercase file",
  );
  for (const extension of [
    "py",
    "js",
    "ts",
    "c",
    "cpp",
    "java",
    "html",
    "css",
    "rs",
    "go",
    "sh",
  ]) {
    const name = `language_sample.${extension}`;
    const content = "  original source with `backticks`\r\n\tand whitespace\n";
    const original = await writeArtifact(directory, {
      id: extension,
      name,
      content,
    });
    const duplicate = await writeArtifact(directory, {
      id: extension + "-duplicate",
      name,
      content: "new source",
    });
    assert.equal(original.name, name);
    assert.equal(
      duplicate.name,
      extension === "java" ? name : `language_sample_2.${extension}`,
    );
    assert.notEqual(original.path, duplicate.path);
    assert.equal(await fs.readFile(original.path, "utf8"), content);
    assert.equal(await fs.readFile(duplicate.path, "utf8"), "new source");
  }
  const java = {
    name: "SumNumbers.java",
    content: "public class SumNumbers { public SumNumbers() {} }",
  };
  const javaFiles = await Promise.all(
    Array.from({ length: 3 }, () => writeArtifact(directory, java)),
  );
  assert.equal(new Set(javaFiles.map((a) => a.path)).size, 3);
  for (const saved of javaFiles) {
    assert.equal(path.basename(saved.path), "SumNumbers.java");
    assert.equal(saved.name, "SumNumbers.java");
    assert.equal(await fs.readFile(saved.path, "utf8"), java.content);
    assert.ok(saved.path.startsWith(directory + path.sep));
  }
  console.log(
    "Artifact files: readable disk names, concurrent collisions, case-insensitive collisions and original content preservation passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
