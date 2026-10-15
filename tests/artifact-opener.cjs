const assert = require("node:assert/strict");
const { createArtifactOpener } = require("../electron/artifact-opener.cjs");
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
      if (platform === "win32") {
        assert.ok(args[0].endsWith("resources\\app\\out\\cli.js"));
        assert.equal(options.env.ELECTRON_RUN_AS_NODE, "1");
        assert.notEqual(args[0], target);
      } else assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
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
  // Windows discovery uses PATH shims and registry, never cmd.exe or a shell.
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
    assert.ok(calls.every(([, , options]) => options.shell === false));
  }
  console.log(
    "Artifact opening: Windows/Fedora associations, all code languages via VS Code, PATH/registry/configured discovery, separate arguments, invalid paths/types, missing apps, launch failures and bounded single attempts passed (mocked launch APIs).",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
