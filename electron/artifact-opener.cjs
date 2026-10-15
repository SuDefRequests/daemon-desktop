const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { CODE_EXTENSIONS } = require("./code-languages.cjs");
const DEFAULT_EXTENSIONS = new Set([
  ".docx",
  ".pptx",
  ".xlsx",
  ".pdf",
  ".csv",
  ".txt",
  ".md",
]);
const execute = (file, args, options) =>
  new Promise((resolve, reject) => {
    childProcess.execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });

function createArtifactOpener({
  shell,
  platform = process.platform,
  env = process.env,
  run = execute,
  realpath = fs.realpath,
  stat = fs.stat,
  timeoutMs = 8000,
} = {}) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const options = {
    timeout: timeoutMs,
    maxBuffer: 128 * 1024,
    windowsHide: true,
    shell: false,
  };
  const exists = async (file) =>
    (await stat(file).catch(() => null))?.isFile() === true;
  async function findCode(candidates, discovered) {
    for (let candidate of candidates) {
      candidate = candidate.trim().replace(/^"(.*)"$/, "$1");
      if (!paths.isAbsolute(candidate)) continue;
      if (
        ["code.cmd", "code"].includes(paths.basename(candidate).toLowerCase())
      )
        candidate = paths.resolve(paths.dirname(candidate), "..", "Code.exe");
      if (paths.basename(candidate).toLowerCase() !== "code.exe") continue;
      const cli = paths.join(
        paths.dirname(candidate),
        "resources",
        "app",
        "out",
        "cli.js",
      );
      if (await exists(candidate)) {
        discovered.add(candidate);
        if (await exists(cli)) return { executable: candidate, cli };
      }
    }
    return null;
  }
  async function windowsCode(signal) {
    const discovered = new Set();
    const candidates = [];
    if (env.DAEMON_VSCODE_PATH) candidates.push(env.DAEMON_VSCODE_PATH);
    else {
      // Electron may inherit an older PATH than a newly opened terminal. Inspect
      // its PATH directly and standard installations as well as where/registry.
      const value = (key) =>
        Object.entries(env).find(
          ([name]) => name.toLowerCase() === key.toLowerCase(),
        )?.[1];
      for (const directory of (value("PATH") || "")
        .split(";")
        .filter(Boolean)) {
        const root = directory.trim().replace(/^"(.*)"$/, "$1");
        candidates.push(
          paths.join(root, "Code.exe"),
          paths.join(root, "code.cmd"),
          paths.join(root, "code"),
        );
      }
      for (const [key, suffix] of [
        ["LOCALAPPDATA", "Programs\\Microsoft VS Code\\Code.exe"],
        ["ProgramFiles", "Microsoft VS Code\\Code.exe"],
        ["ProgramFiles(x86)", "Microsoft VS Code\\Code.exe"],
      ]) {
        if (value(key)) candidates.push(paths.join(value(key), suffix));
      }
      const installed = await findCode(candidates, discovered);
      if (installed) return installed;
      for (const name of ["code", "code.cmd", "Code.exe"]) {
        try {
          const { stdout } = await run("where.exe", [name], {
            ...options,
            signal,
          });
          candidates.push(...stdout.trim().split(/\r?\n/).filter(Boolean));
          const found = await findCode(candidates, discovered);
          if (found) return found;
        } catch (error) {
          if (error.killed || signal.aborted) throw error;
        }
      }
      for (const hive of ["HKCU", "HKLM"]) {
        try {
          const { stdout } = await run(
            "reg.exe",
            [
              "query",
              `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe`,
              "/ve",
            ],
            { ...options, signal },
          );
          const value = stdout
            .match(/REG_SZ\s+(.+)/i)?.[1]
            .trim()
            .replace(/^"|"$/g, "");
          if (value) candidates.push(value);
        } catch (error) {
          if (error.killed || signal.aborted) throw error;
        }
      }
    }
    const found = await findCode(candidates, discovered);
    if (found) return found;
    if (discovered.size)
      throw new Error(
        `VS Code was discovered at ${[...discovered].join(", ")}, but its resources/app/out/cli.js launcher is missing or inaccessible. Repair the VS Code installation.`,
      );
    throw new Error(
      "VS Code was not found. Install it with its PATH option, or set DAEMON_VSCODE_PATH to its Code.exe path and restart VIDUR AI.",
    );
  }
  async function openCode(target, signal) {
    const editorEnv = { ...env };
    delete editorEnv.NODE_OPTIONS;
    delete editorEnv.NODE_PATH;
    delete editorEnv.VSCODE_DEV;
    delete editorEnv.ELECTRON_RUN_AS_NODE;
    if (platform === "win32") {
      const { executable, cli } = await windowsCode(signal);
      signal.throwIfAborted();
      // This is VS Code's own CLI entry point, as used by code.cmd. Generated
      // source is only a file argument after '--'; never a runtime entry point.
      try {
        await run(executable, [cli, "--reuse-window", "--", target], {
          ...options,
          signal,
          env: { ...editorEnv, ELECTRON_RUN_AS_NODE: "1" },
        });
      } catch (error) {
        if (error.killed || signal.aborted) throw error;
        throw new Error(
          `VS Code was discovered at ${executable}, but launching failed: ${error.message}`,
        );
      }
    } else if (platform === "linux" || platform === "darwin") {
      const executable = env.DAEMON_VSCODE_PATH || "code";
      if (
        env.DAEMON_VSCODE_PATH &&
        (!paths.isAbsolute(executable) || !(await exists(executable)))
      )
        throw new Error(
          "DAEMON_VSCODE_PATH must point to the installed VS Code launcher.",
        );
      if (paths.basename(executable) !== "code")
        throw new Error(
          "The configured launcher must be VS Code's code executable.",
        );
      await run(executable, ["--reuse-window", "--", target], {
        ...options,
        signal,
        env: editorEnv,
      });
    } else
      throw new Error("VS Code opening is not supported on this platform.");
    return { status: "requested", message: "Open request sent to VS Code." };
  }
  async function open(target, signal) {
    if (
      typeof target !== "string" ||
      !paths.isAbsolute(target) ||
      /[\u0000-\u001f]/.test(target)
    )
      throw new Error("Invalid saved artifact path.");
    if (
      (await realpath(target)) !== paths.resolve(target) ||
      !(await stat(target)).isFile()
    )
      throw new Error("Saved artifact path was rejected.");
    const extension = paths.extname(target).toLowerCase();
    if (!CODE_EXTENSIONS.has(extension) && !DEFAULT_EXTENSIONS.has(extension))
      throw new Error("Opening this file type is not supported.");
    try {
      signal.throwIfAborted();
      if (CODE_EXTENSIONS.has(extension)) return await openCode(target, signal);
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return {
        status: "requested",
        message: "Open request sent to the default application.",
      };
    } catch (error) {
      if (error.code === "ENOENT" && CODE_EXTENSIONS.has(extension))
        throw new Error(
          "VS Code was not found. Install its code launcher or configure DAEMON_VSCODE_PATH, then restart VIDUR AI.",
        );
      if (error.killed)
        throw new Error(
          "The application launch timed out; opening was not confirmed.",
        );
      throw new Error(`Unable to open the saved file: ${error.message}`);
    }
  }
  // Bound OS associations that may otherwise wait indefinitely for an Open With
  // dialog. A timeout never triggers another launch or another generation.
  const pending = new Map();
  return {
    open(target) {
      if (pending.has(target)) return pending.get(target);
      let timer;
      const controller = new AbortController();
      const operation = Promise.race([
        open(target, controller.signal),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new Error(
                "Application opening was not confirmed in time. The file remains saved.",
              ),
            );
          }, timeoutMs * 2);
        }),
      ]).finally(() => {
        clearTimeout(timer);
        pending.delete(target);
      });
      pending.set(target, operation);
      return operation;
    },
  };
}
module.exports = { createArtifactOpener, DEFAULT_EXTENSIONS };
