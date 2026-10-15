const assert = require("node:assert/strict");
const {
  createArtifactOpener: makeOpener,
} = require("../electron/artifact-opener.cjs");
// Native process creation is stubbed; no Windows programs run on this host.
const createArtifactOpener = (options) =>
  makeOpener({ ...options, start: options.start || options.run });
const { CODE_EXTENSIONS } = require("../electron/code-languages.cjs");
const fileStat = async () => ({ isFile: () => true });
const missing = () => Object.assign(new Error("not found"), { code: "ENOENT" });
(async () => {
  for (const platform of ["win32", "linux"]) {
    const prefix =
      platform === "win32" ? "C:\\VIDUR files\\" : "/tmp/VIDUR files/";
    const calls = [];
    const editor =
      platform === "win32"
        ? "D:\\Apps\\VS Code\\Code.exe"
        : "/opt/vscode/bin/code";
    const opener = createArtifactOpener({
      platform,
      env: {
        DAEMON_VSCODE_PATH: editor,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_OPTIONS: "--bad-option",
      },
      realpath: async (p) => p,
      stat: fileStat,
      shell: {
        openPath: async (p) => {
          calls.push(["default", p]);
          return "";
        },
      },
      run: async (...args) => {
        calls.push(["editor", ...args]);
        return { stdout: "" };
      },
    });
    for (const extension of [
      "docx",
      "pptx",
      "xlsx",
      "pdf",
      "csv",
      "txt",
      "md",
    ]) {
      const target = prefix + "sample." + extension;
      assert.equal((await opener.open(target)).status, "requested");
      assert.deepEqual(calls.at(-1), ["default", target]);
    }
    for (const extension of CODE_EXTENSIONS) {
      const target = prefix + "source" + extension;
      await opener.open(target);
      const [type, command, args, options] = calls.at(-1);
      assert.equal(type, "editor");
      assert.equal(command, editor);
      assert.deepEqual(args.slice(-3), ["--reuse-window", "--", target]);
      assert.equal(options.shell, false);
      assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.deepEqual(args, ["--reuse-window", "--", target]);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
    }
    const count = calls.length;
    for (const target of [
      "relative.py",
      prefix + "bad.exe",
      prefix + "bad.cmd",
      prefix + "bad\u0000.py",
    ])
      await assert.rejects(opener.open(target));
    assert.equal(calls.length, count);
    await assert.rejects(
      createArtifactOpener({
        platform,
        env: {},
        stat: fileStat,
        realpath: async () => prefix + "elsewhere.py",
      }).open(prefix + "source.py"),
      /rejected/,
    );
    await assert.rejects(
      createArtifactOpener({
        platform,
        env: {},
        stat: async () => ({ isFile: () => false }),
        realpath: async (p) => p,
      }).open(prefix + "folder.py"),
      /rejected/,
    );
    await assert.rejects(
      createArtifactOpener({
        platform,
        env: {},
        stat: fileStat,
        realpath: async () => {
          throw missing();
        },
      }).open(prefix + "missing.py"),
    );
    await assert.rejects(
      createArtifactOpener({
        platform,
        stat: fileStat,
        realpath: async (p) => p,
        shell: { openPath: async () => "No application is associated" },
      }).open(prefix + "sample.docx"),
      /No application/,
    );
    await assert.rejects(
      createArtifactOpener({
        platform,
        env: {},
        stat: fileStat,
        realpath: async (p) => p,
        run: async () => {
          throw missing();
        },
      }).open(prefix + "sample.py"),
      /VS Code was not found/,
    );
    await assert.rejects(
      createArtifactOpener({
        platform,
        env: { DAEMON_VSCODE_PATH: editor },
        stat: fileStat,
        realpath: async (p) => p,
        run: async () => {
          throw new Error("Editor failed");
        },
      }).open(prefix + "sample.py"),
      /Editor failed/,
    );
    let attempts = 0;
    await assert.rejects(
      createArtifactOpener({
        platform,
        timeoutMs: 5,
        stat: fileStat,
        realpath: async (p) => p,
        shell: {
          openPath: () => {
            attempts++;
            return new Promise(() => {});
          },
        },
      }).open(prefix + "sample.docx"),
      /not confirmed/,
    );
    assert.equal(attempts, 1);
  }
  // Standard installations use native launch; batch fallback is tested separately.
  let release, enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  let launches = 0;
  const coalesced = createArtifactOpener({
    platform: "linux",
    realpath: async (p) => p,
    stat: fileStat,
    shell: {
      openPath: () => {
        launches++;
        enter();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const first = coalesced.open("/tmp/same.docx");
  const second = coalesced.open("/tmp/same.docx");
  assert.equal(first, second);
  await entered;
  assert.equal(launches, 1);
  release("");
  await Promise.all([first, second]);
  for (const source of ["path", "registry"]) {
    const calls = [];
    const root = "E:\\Portable Apps\\VSCode";
    const opener = createArtifactOpener({
      platform: "win32",
      env: {},
      realpath: async (p) => p,
      stat: fileStat,
      run: async (command, args, options) => {
        calls.push([command, args, options]);
        if (
          source === "path" &&
          command === "where.exe" &&
          args[0] === "code.cmd"
        )
          return { stdout: root + "\\bin\\code.cmd\r\n" };
        if (source === "registry" && command === "reg.exe")
          return {
            stdout: "    (Default)    REG_SZ    " + root + "\\Code.exe\r\n",
          };
        if (command.endsWith("Code.exe")) return { stdout: "" };
        throw missing();
      },
    });
    await opener.open("C:\\Saved\\file.py");
    assert.equal(calls.at(-1)[0], root + "\\Code.exe");
    if (source === "path")
      assert.ok(!calls.some(([command]) => command === "reg.exe"));
    assert.ok(calls.every(([, , options]) => options.shell === false));
  }
  // Reproduce the reported Windows user installation with realistic file checks.
  const win = require("node:path").win32;
  const root = "C:\\Users\\Lenovo\\AppData\\Local\\Programs\\Microsoft VS Code";
  const exe = win.join(root, "Code.exe");
  const cli = win.join(root, "resources", "app", "out", "cli.js");
  const target = "C:\\Saved files\\sum & two numbers.py";
  for (const mode of [
    "where-code",
    "path",
    "local",
    "system",
    "configured-code",
    "configured-cmd",
    "configured-exe",
    "launch-error",
    "broken-cli",
  ]) {
    const calls = [];
    const env =
      mode === "path"
        ? { Path: win.join(root, "bin") }
        : mode === "local"
          ? { LOCALAPPDATA: "C:\\Users\\Lenovo\\AppData\\Local" }
          : mode === "system"
            ? { ProgramFiles: "C:\\Program Files" }
            : mode.startsWith("configured")
              ? {
                  DAEMON_VSCODE_PATH: mode.endsWith("exe")
                    ? exe
                    : win.join(
                        root,
                        "bin",
                        mode.endsWith("cmd") ? "code.cmd" : "code",
                      ),
                }
              : {};
    const expected =
      mode === "system"
        ? "C:\\Program Files\\Microsoft VS Code\\Code.exe"
        : exe;
    const expectedCli = win.join(
      win.dirname(expected),
      "resources",
      "app",
      "out",
      "cli.js",
    );
    const opener = createArtifactOpener({
      platform: "win32",
      env,
      realpath: async (p) => p,
      stat: async (p) => ({
        isFile: () =>
          p === target ||
          p === expected ||
          (p === expectedCli && mode !== "broken-cli"),
      }),
      run: async (command, args, options) => {
        calls.push([command, args, options]);
        if (command === "where.exe" && args[0] === "code")
          return {
            stdout:
              win.join(root, "bin", "code") +
              "\r\n" +
              win.join(root, "bin", "code.cmd") +
              "\r\n",
          };
        if (command === expected) {
          if (mode === "launch-error")
            throw Object.assign(new Error("spawn Code.exe ENOENT (fixture)"), {
              code: "ENOENT",
            });
          return { stdout: "" };
        }
        throw missing();
      },
    });
    if (mode === "launch-error") {
      await assert.rejects(
        opener.open(target),
        /could not start: spawn Code.exe ENOENT/,
      );
    } else {
      assert.equal((await opener.open(target)).status, "requested");
      const [command, args, options] = calls.at(-1);
      assert.equal(command, expected);
      assert.deepEqual(args, ["--reuse-window", "--", target]);
      assert.equal(options.shell, false);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
      assert.equal(calls.filter(([command]) => command === expected).length, 1);
    }
  }
  for (const mode of [
    "shim-only",
    "spawn-fallback",
    "fallback-error",
    "unsafe-path",
  ]) {
    const shim = win.join(root, "bin", "code.cmd");
    const saved =
      mode === "unsafe-path"
        ? "C:\\Saved files\\bad & name.py"
        : "C:\\Saved files\\find factorial.py";
    const calls = [];
    const opener = createArtifactOpener({
      platform: "win32",
      env: { DAEMON_VSCODE_PATH: shim },
      realpath: async (p) => p,
      stat: async (p) => ({
        isFile: () =>
          p === saved || p === shim || (mode === "spawn-fallback" && p === exe),
      }),
      start: async (command, args) => {
        calls.push([command, args]);
        throw Object.assign(new Error("direct access denied"), {
          code: "EACCES",
        });
      },
      run: async (command, args, options) => {
        calls.push([command, args]);
        assert.equal(command, "cmd.exe");
        assert.deepEqual(args.slice(0, 4), ["/d", "/v:off", "/s", "/c"]);
        assert.equal(
          args[4],
          '\"\"%DAEMON_EDITOR_LAUNCHER%\" --reuse-window -- \"%DAEMON_EDITOR_FILE%\"\"',
        );
        assert.equal(options.windowsVerbatimArguments, true);
        assert.equal(options.env.DAEMON_EDITOR_LAUNCHER, shim);
        assert.equal(options.env.DAEMON_EDITOR_FILE, saved);
        assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
        assert.equal(options.shell, false);
        if (mode === "fallback-error")
          throw new Error("batch launcher exited with code 1");
        return { stdout: "" };
      },
    });
    if (mode === "unsafe-path") {
      await assert.rejects(opener.open(saved), /cannot safely handle/);
      assert.equal(calls.length, 0);
    } else if (mode === "fallback-error") {
      await assert.rejects(
        opener.open(saved),
        /batch launcher exited with code 1/,
      );
    } else {
      assert.equal((await opener.open(saved)).status, "requested");
      assert.equal(calls.length, mode === "spawn-fallback" ? 2 : 1);
    }
  }
  // Real spawn adapter resolves on process creation, without waiting for GUI exit.
  const cp = require("node:child_process");
  const originalSpawn = cp.spawn;
  let unrefs = 0;
  try {
    cp.spawn = (command, args, options) => {
      assert.equal(command, exe);
      assert.deepEqual(args, ["--reuse-window", "--", target]);
      assert.equal(options.detached, true);
      assert.equal(options.shell, false);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
      const child = new (require("node:events").EventEmitter)();
      child.unref = () => unrefs++;
      process.nextTick(() => child.emit("spawn"));
      return child;
    };
    await makeOpener({
      platform: "win32",
      env: { DAEMON_VSCODE_PATH: exe },
      realpath: async (p) => p,
      stat: async (p) => ({ isFile: () => p === exe || p === target }),
    }).open(target);
    assert.equal(unrefs, 1);
  } finally {
    cp.spawn = originalSpawn;
  }
  console.log(
    "Artifact opening: Windows/Fedora associations, all code languages via VS Code, PATH/registry/configured discovery, separate arguments, invalid paths/types, missing apps, launch failures and bounded single attempts passed (mocked launch APIs).",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
