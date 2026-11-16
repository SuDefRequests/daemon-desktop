const { execFile } = require("node:child_process");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_AUDIO_BYTES = 40 * 1024 * 1024; // ~10 min of 16 kHz mono Int16
const TIMEOUT_MS = 180_000;

/**
 * Offline speech-to-text via a bundled whisper.cpp CLI.
 * The laptop does all the compute; nothing leaves the machine.
 */
function createStt({
  appPath = path.join(__dirname, ".."),
  resourcesPath = process.resourcesPath,
} = {}) {
  // In dev the binary lives in <repo>/whisper; packaged, extraResources copy
  // it into <resources>/whisper (see build.extraResources in package.json).
  const base = fs.existsSync(path.join(appPath, "whisper"))
    ? path.join(appPath, "whisper")
    : path.join(resourcesPath, "whisper");
  const bin = path.join(
    base,
    process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli",
  );
  // Dev keeps the model in brain/models/ (single copy); the packaged app gets
  // it copied next to the binary as whisper/ggml-base.en.bin.
  const modelPaths = [
    path.join(base, "ggml-base.en.bin"),
    path.join(appPath, "brain", "models", "ggml-base.en.bin"),
  ];
  const model = modelPaths.find((p) => fs.existsSync(p)) || modelPaths[0];

  async function requireFile(file, what) {
    try {
      await fsp.access(file);
    } catch {
      throw new Error(
        `Voice input is not set up: missing ${what} at ${file}. ` +
          (process.platform === "win32"
            ? "Download the whisper.cpp Windows release and drop the files into the whisper/ folder (see README)."
            : "Run the whisper.cpp build steps in the README."),
      );
    }
  }

  async function transcribe(data) {
    const audio = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!audio.length) throw new Error("No audio was recorded.");
    if (audio.length > MAX_AUDIO_BYTES)
      throw new Error("Recording is too long (10 minute limit).");
    if (audio.subarray(0, 4).toString("latin1") !== "RIFF")
      throw new Error("Audio format rejected.");

    await requireFile(bin, "the whisper.cpp binary");
    await requireFile(model, "the speech model");

    const env = { ...process.env };
    if (process.platform !== "win32")
      env.LD_LIBRARY_PATH =
        base + (env.LD_LIBRARY_PATH ? path.delimiter + env.LD_LIBRARY_PATH : "");

    const wav = path.join(
      os.tmpdir(),
      `vidur-stt-${process.pid}-${Date.now()}.wav`,
    );
    try {
      await fsp.writeFile(wav, audio, { mode: 0o600 });
      const stdout = await new Promise((resolve, reject) => {
        execFile(
          bin,
          ["-m", model, "-f", wav, "-nt", "-np", "-l", "en"],
          {
            timeout: TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
            env,
          },
          (error, stdout, stderr) => {
            if (error) {
              if (error.killed)
                reject(new Error("Transcription timed out."));
              else
                reject(
                  new Error(
                    `whisper-cli failed: ${(stderr || error.message)
                      .trim()
                      .split("\n")
                      .pop()}`,
                  ),
                );
            } else resolve(stdout);
          },
        );
      });
      return stdout.trim();
    } finally {
      await fsp.rm(wav, { force: true });
    }
  }

  return { transcribe };
}

module.exports = { createStt };
