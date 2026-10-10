const fs = require("node:fs/promises");
const path = require("node:path");

// Exclusive creation also handles files created outside DAEMON and concurrent writers.
async function writeArtifact(directory, artifact) {
  await fs.mkdir(directory, { recursive: true });
  const root = await fs.realpath(directory);
  const extension = path.extname(artifact.name);
  const stem = artifact.name.slice(0, -extension.length);
  const existing = new Set(
    (await fs.readdir(root)).map((name) => name.toLowerCase()),
  );
  for (let index = 1; index <= 10000; index++) {
    const name = index === 1 ? artifact.name : `${stem}_${index}${extension}`;
    if (existing.has(name.toLowerCase())) continue;
    const target = path.join(root, name);
    try {
      await fs.writeFile(target, artifact.content, { flag: "wx", mode: 0o600 });
      return { ...artifact, name, path: target };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate a unique filename.");
}
module.exports = { writeArtifact };
