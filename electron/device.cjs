const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const execute = promisify(execFile);
const HEALTH_URL = "http://127.0.0.1:5000/health";
const status = (state, label, detail) => ({ state, label, detail });
const unknown = () =>
  status(
    "unknown",
    "Connection status unknown",
    "Checking the Android device and brain service…",
  );

function createDeviceMonitor({
  mode,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  run = execute,
  exists = async (file) => !!(await fs.stat(file).catch(() => null)),
  fetchImpl = (...args) => globalThis.fetch(...args),
  onChange = () => {},
  intervalMs = 10000,
  timeoutMs = 3000,
} = {}) {
  let snapshot =
    mode === "mock"
      ? status(
          "mock",
          "Mock mode",
          "Simulated responses · device checks are disabled",
        )
      : unknown();
  let executable,
    pending,
    timer,
    stopped = false;
  const command = (adb, args) =>
    run(adb, args, {
      timeout: 4000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
      shell: false,
    });
  async function devices() {
    if (executable)
      return (await command(executable, ["devices", "-l"])).stdout;
    const binary = platform === "win32" ? "adb.exe" : "adb";
    const roots = [
      env.ANDROID_HOME,
      env.ANDROID_SDK_ROOT,
      platform === "win32" &&
        env.LOCALAPPDATA &&
        path.join(env.LOCALAPPDATA, "Android", "Sdk"),
      path.join(home, "Android", "Sdk"),
    ].filter(Boolean);
    const candidates = env.DAEMON_ADB_PATH
      ? [env.DAEMON_ADB_PATH]
      : [
          ...new Set(
            roots.map((root) => path.join(root, "platform-tools", binary)),
          ),
        ].concat(binary);
    for (const candidate of candidates) {
      if (candidate !== binary && !(await exists(candidate))) continue;
      try {
        const result = await command(candidate, ["devices", "-l"]);
        executable = candidate;
        return result.stdout;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const error = new Error("ADB was not found");
    error.code = "ENOENT";
    throw error;
  }
  async function health() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response, reader;
    try {
      response = await fetchImpl(HEALTH_URL, {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (
        !response.ok ||
        !/^application\/json(?:;|$)/i.test(
          response.headers.get("content-type") || "",
        )
      )
        return false;
      reader = response.body?.getReader();
      if (!reader) return false;
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) return false;
        chunks.push(Buffer.from(value));
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return data?.service === "vidur-brain" && data.status === "ok";
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      if (reader) await reader.cancel().catch(() => {});
      else if (response?.body) await response.body.cancel().catch(() => {});
    }
  }
  async function check() {
    if (mode !== "android") return snapshot;
    let output;
    try {
      output = await devices();
    } catch (error) {
      if (error.code === "ENOENT") {
        executable = undefined;
        return status(
          "adb-missing",
          "ADB unavailable",
          "Install Android platform-tools or configure DAEMON_ADB_PATH / ANDROID_HOME.",
        );
      }
      return status(
        "unknown",
        "Device check failed",
        "ADB could not inspect devices. Check platform-tools, USB access and the ADB server.",
      );
    }
    if (
      typeof output !== "string" ||
      !output.includes("List of devices attached")
    )
      return status(
        "unknown",
        "Device check failed",
        "ADB returned an unrecognized device list. Check platform-tools and refresh status.",
      );
    const entries = output
      .split(/\r?\n/)
      .map((line) =>
        line
          .trim()
          .match(/^(\S+)\s+(device|unauthorized|offline|no permissions)\b/),
      )
      .filter(Boolean)
      .map((match) => ({ serial: match[1], state: match[2] }));
    let device;
    if (env.ANDROID_SERIAL)
      device = entries.find((item) => item.serial === env.ANDROID_SERIAL);
    else {
      const authorized = entries.filter((item) => item.state === "device");
      if (authorized.length > 1)
        return status(
          "unknown",
          "Select an Android device",
          "Multiple authorized devices detected. Set ANDROID_SERIAL before launching VIDUR AI.",
        );
      device = authorized[0] || entries[0];
    }
    if (!device)
      return status(
        "disconnected",
        "Device not connected",
        "Connect the Android device with USB debugging enabled.",
      );
    if (device.state === "unauthorized")
      return status(
        "unauthorized",
        "Authorization required",
        "Unlock the Android device and approve this computer’s USB debugging request.",
      );
    if (device.state !== "device")
      return status(
        "device-unavailable",
        "Device unavailable",
        "Check USB debugging, the cable and USB permissions; ADB reports the device is unavailable.",
      );
    try {
      const list = async () =>
        (await command(executable, ["forward", "--list"])).stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.trim().split(/\s+/));
      let rules = await list();
      const conflicts = rules.filter((rule) => rule[1] === "tcp:5000");
      if (
        conflicts.some(
          (rule) => rule[0] !== device.serial || rule[2] !== "tcp:5000",
        )
      )
        return status(
          "forward-error",
          "Forwarding conflict",
          "Local port 5000 is forwarded to another device or service. Resolve the existing rule before retrying.",
        );
      if (!conflicts.length) {
        await command(executable, [
          "-s",
          device.serial,
          "forward",
          "--no-rebind",
          "tcp:5000",
          "tcp:5000",
        ]);
        rules = await list();
      }
      if (
        !rules.some(
          (rule) =>
            rule[0] === device.serial &&
            rule[1] === "tcp:5000" &&
            rule[2] === "tcp:5000",
        )
      )
        throw new Error("Forwarding not verified");
    } catch {
      return status(
        "forward-error",
        "Forwarding unavailable",
        "Could not verify ADB forwarding on port 5000. Check the device and whether another application owns that port.",
      );
    }
    if (!(await health()))
      return status(
        "brain-unavailable",
        "Brain service unavailable",
        "USB forwarding is verified, but the brain health check failed. Start or update the Flask brain on the phone (port 5000).",
      );
    return status(
      "connected",
      "Connected",
      "Brain service reachable · Qwen readiness is checked when you send a prompt",
    );
  }
  function refresh() {
    if (pending) return pending;
    if (stopped) return Promise.resolve(snapshot);
    pending = check()
      .catch(() =>
        status(
          "unknown",
          "Connection status unknown",
          "The device check failed. Refresh status or restart VIDUR AI.",
        ),
      )
      .then((next) => {
        if (!stopped && JSON.stringify(next) !== JSON.stringify(snapshot)) {
          snapshot = next;
          onChange(snapshot);
        }
        return snapshot;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  async function tick() {
    await refresh();
    if (!stopped && mode === "android") {
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    }
  }
  return {
    getStatus: () => snapshot,
    refresh,
    start: () => {
      if (!timer && !pending && !stopped) void tick();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
module.exports = { createDeviceMonitor, HEALTH_URL };
