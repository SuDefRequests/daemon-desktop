// Only tests import this module. No real desktop application is launched.
export async function stubArtifactApplications(app, directory) {
  await app.evaluate(async ({ shell }, directory) => {
    const fs = process.getBuiltinModule("node:fs").promises;
    const path = process.getBuiltinModule("node:path");
    const cp = process.getBuiltinModule("node:child_process");
    const root = path.join(directory, "fixture-editor");
    await fs.mkdir(path.join(root, "resources", "app", "out"), {
      recursive: true,
    });
    const executable = path.join(
      root,
      process.platform === "win32" ? "Code.exe" : "code",
    );
    await fs.writeFile(executable, "test fixture, never executed");
    await fs.writeFile(
      path.join(root, "resources", "app", "out", "cli.js"),
      "test fixture, never executed",
    );
    process.env.DAEMON_VSCODE_PATH = executable;
    globalThis.daemonAppActions = [];
    globalThis.daemonOpenError = "";
    globalThis.daemonCodeError = "";
    shell.openPath = async (target) => {
      globalThis.daemonAppActions.push(["default", target]);
      return globalThis.daemonOpenError;
    };
    const original = cp.execFile;
    cp.execFile = (file, args, options, callback) => {
      if (file !== executable) return original(file, args, options, callback);
      globalThis.daemonAppActions.push(["vscode", args.at(-1)]);
      callback(
        globalThis.daemonCodeError
          ? new Error(globalThis.daemonCodeError)
          : null,
        "",
        "",
      );
      return { pid: 0 };
    };
  }, directory);
}
