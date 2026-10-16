const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const {
  validateConfiguration,
} = require("app-builder-lib/out/util/config/config.js");

(async () => {
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
  assert.equal(
    manifest.devDependencies["electron-builder"],
    lock.packages[""].devDependencies["electron-builder"],
  );
  await validateConfiguration(manifest.build, { isEnabled: false });
  assert.equal(manifest.build.appId, "com.vidur.desktop");
  assert.equal(manifest.build.productName, "VIDUR AI");
  assert.equal(manifest.build.forceCodeSigning, false);
  assert.equal(manifest.build.directories.output, "release");
  assert.equal(manifest.build.win.target, "nsis");
  assert.equal(manifest.build.nsis.oneClick, false);
  assert.equal(manifest.build.nsis.allowToChangeInstallationDirectory, true);
  for (const file of [
    "dist/**/*",
    "electron/**/*",
    "brain/**/*",
    "package.json",
  ])
    assert.ok(manifest.build.files.includes(file));

  // Exercise actual main-process startup until the device-monitor boundary.
  // No Electron window, ADB process or HTTP request is started.
  const entry = path.join(root, manifest.main);
  const source = fs.readFileSync(entry, "utf8");
  const mainRequire = createRequire(entry);
  for (const development of [undefined, "1"]) {
    for (const provider of [undefined, "android", "mock", "invalid"]) {
      let startup, selected;
      const boundary = new Error("device monitor boundary");
      const env = {};
      if (development) env.DAEMON_DEV = development;
      if (provider) env.DAEMON_PROVIDER = provider;
      vm.runInNewContext(
        source,
        {
          require(name) {
            if (name === "electron")
              return {
                app: {
                  whenReady: () => ({
                    then: (callback) => {
                      startup = callback;
                    },
                  }),
                  on() {},
                  requestSingleInstanceLock: () => true,
                },
              };
            if (name === "./device.cjs")
              return {
                createDeviceMonitor({ mode }) {
                  selected = mode;
                  throw boundary;
                },
              };
            return mainRequire(name);
          },
          process: { env },
          console,
          __dirname: path.dirname(entry),
        },
        { filename: entry },
      );
      await assert.rejects(startup(), (error) =>
        provider === "invalid"
          ? /DAEMON_PROVIDER/.test(error.message)
          : error === boundary,
      );
      assert.equal(
        selected,
        provider === "invalid" ? undefined : provider || "android",
      );
    }
  }
  console.log(
    "Packaging: JSON/lockfile consistency, builder schema/NSIS settings, compiled/development Android defaults and explicit mock override passed (startup dependencies stubbed).",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
