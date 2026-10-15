const fs = require("node:fs/promises");
const path = require("node:path");

// Exclusive creation also handles files created outside DAEMON and concurrent writers.
async function writeArtifact(directory, artifact) {
  // Generate and validate the entire binary before creating or registering a file.
  const data =
    path.extname(artifact.name) === ".pptx"
      ? await require("./presentation.cjs").createPresentation(
          artifact.content,
          artifact.presentationStatus,
        )
      : path.extname(artifact.name) === ".docx"
        ? await require("./document.cjs").createDocument(artifact.content)
        : artifact.content;
  await fs.mkdir(directory, { recursive: true });
  const root = await fs.realpath(directory);
  const extension = path.extname(artifact.name);
  const stem = artifact.name.slice(0, -extension.length);
  const existing = new Set(
    (await fs.readdir(root)).map((name) => name.toLowerCase()),
  );
  for (let index = 1; index <= 10000; index++) {
    // A Java public type must keep its exact filename. Isolate duplicates instead
    // of renaming the file or rewriting generated source (including constructors).
    if (extension === ".java" && index > 1) {
      const folder = await fs.mkdtemp(path.join(root, `${stem}_`));
      const target = path.join(folder, artifact.name);
      try {
        await fs.writeFile(target, data, {
          flag: "wx",
          mode: 0o600,
        });
        return { ...artifact, path: target };
      } catch (error) {
        await fs.rmdir(folder).catch(() => {});
        throw error;
      }
    }
    const name = index === 1 ? artifact.name : `${stem}_${index}${extension}`;
    if (existing.has(name.toLowerCase())) continue;
    const target = path.join(root, name);
    try {
      await fs.writeFile(target, data, { flag: "wx", mode: 0o600 });
      return { ...artifact, name, path: target };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate a unique filename.");
}
module.exports = { writeArtifact };
