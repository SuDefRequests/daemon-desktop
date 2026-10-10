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
  console.log(
    "Artifact files: readable disk names, concurrent collisions, case-insensitive collisions and original content preservation passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
