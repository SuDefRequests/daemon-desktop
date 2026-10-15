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

// A GUI process can stay alive indefinitely. Confirm process creation, not exit.
const startWindows = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = childProcess.spawn(file, args, {
      env: options.env,
      windowsHide: true,
      shell: false,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

function createArtifactOpener({
  shell,
  platform = process.platform,
  env = process.env,
  run = execute,
  start = startWindows,
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
  async function findCode(candidates) {
    let fallback;
    for (let candidate of candidates) {
      candidate = candidate.trim().replace(/^"(.*)"$/, "$1");
      if (!paths.isAbsolute(candidate)) continue;
      const name = paths.basename(candidate).toLowerCase();
      let launcher;
      if (["code.cmd", "code"].includes(name)) {
        launcher = paths.join(paths.dirname(candidate), "code.cmd");
        candidate = paths.resolve(paths.dirname(candidate), "..", "Code.exe");
      } else if (name === "code.exe") {
        launcher = paths.join(paths.dirname(candidate), "bin", "code.cmd");
      } else continue;
      launcher = (await exists(launcher)) ? launcher : undefined;
      if (await exists(candidate)) return { executable: candidate, launcher };
      if (launcher) fallback ||= { launcher };
    }
    return fallback;
  }
  async function windowsCode(signal) {
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
      const installed = await findCode(candidates);
      if (installed) return installed;
      for (const name of ["code", "code.cmd", "Code.exe"]) {
        try {
          const { stdout } = await run("where.exe", [name], {
            ...options,
            signal,
          });
          candidates.push(...stdout.trim().split(/\r?\n/).filter(Boolean));
          const found = await findCode(candidates);
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
    const found = await findCode(candidates);
    if (found) return found;
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
      const { executable, launcher } = await windowsCode(signal);
      signal.throwIfAborted();
      let directError;
      if (executable) {
        try {
          await start(executable, ["--reuse-window", "--", target], {
            ...options,
            env: editorEnv,
          });
          return {
            status: "requested",
            message: "Open request sent to VS Code.",
          };
        } catch (error) {
          directError = error;
          // Retry only a failed spawn, never an already-started GUI process.
          if (
            !launcher ||
            !["ENOENT", "EACCES", "ENOEXEC"].includes(error.code)
          )
            throw new Error(
              `VS Code at ${executable} could not start: ${error.message}`,
            );
        }
      }
      signal.throwIfAborted();
      // Batch files require cmd.exe. Only fixed syntax is used, and values are
      // passed via environment variables. Reject cmd metacharacters rather than
      // attempting to escape arbitrary paths through multiple batch expansions.
      if (/["%!^&|<>()\r\n]/.test(launcher + target))
        throw new Error(
          `VS Code launcher fallback cannot safely handle this path.${directError ? " Direct launch failed: " + directError.message : ""}`,
        );
      try {
        await run(
          env.ComSpec || env.COMSPEC || "cmd.exe",
          [
            "/d",
            "/v:off",
            "/s",
            "/c",
            '\"\"%DAEMON_EDITOR_LAUNCHER%\" --reuse-window -- \"%DAEMON_EDITOR_FILE%\"\"',
          ],
          {
            ...options,
            signal,
            windowsVerbatimArguments: true,
            env: {
              ...editorEnv,
              DAEMON_EDITOR_LAUNCHER: launcher,
              DAEMON_EDITOR_FILE: target,
            },
          },
        );
      } catch (error) {
        throw new Error(
          `VS Code launcher ${launcher} could not start: ${error.message}${directError ? "; direct launch failed: " + directError.message : ""}`,
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
