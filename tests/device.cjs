const assert = require("node:assert/strict");
const { createDeviceMonitor, HEALTH_URL } = require("../electron/device.cjs");
const reply = (data = { service: "vidur-brain", status: "ok" }) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
function fixture(options = {}) {
  const state = {
    devices: "phone device",
    rules: "",
    available: true,
    health: true,
    calls: [],
    healthCalls: 0,
    changes: [],
    ...options,
  };
  const monitor = createDeviceMonitor({
    mode: "android",
    env: {},
    exists: async () => false,
    timeoutMs: 15,
    run: async (file, args, config) => {
      state.calls.push({ file, args });
      assert.equal(config.shell, false);
      assert.equal(config.windowsHide, true);
      if (state.missing)
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      if (state.adbError) throw new Error("ADB unavailable");
      if (args[0] === "devices")
        return { stdout: `List of devices attached\n${state.devices}\n` };
      if (args[0] === "forward") return { stdout: state.rules };
      assert.deepEqual(args, [
        "-s",
        "phone",
        "forward",
        "--no-rebind",
        "tcp:5000",
        "tcp:5000",
      ]);
      if (state.forwardFails) throw new Error("port in use");
      if (!state.unverifiedForward) state.rules = "phone tcp:5000 tcp:5000";
      return { stdout: "" };
    },
    fetchImpl: async (url, config) => {
      state.healthCalls++;
      assert.equal(url, HEALTH_URL);
      assert.equal(config.redirect, "error");
      if (state.stalled)
        return new Promise((resolve, reject) =>
          config.signal.addEventListener("abort", () =>
            reject(new Error("timeout")),
          ),
        );
      if (!state.health) throw new TypeError("Flask stopped");
      return state.response ? state.response() : reply();
    },
    onChange: (snapshot) => state.changes.push(snapshot),
    ...options.monitorOptions,
  });
  return { state, monitor };
}
(async () => {
  for (const [options, expected] of [
    [{ devices: "" }, "disconnected"],
    [{ devices: "phone unauthorized" }, "unauthorized"],
    [{ devices: "phone offline" }, "device-unavailable"],
    [{ devices: "phone no permissions" }, "device-unavailable"],
    [{ missing: true }, "adb-missing"],
    [{ adbError: true }, "unknown"],
    [{ devices: "phone device\nother device" }, "unknown"],
    [{ rules: "other tcp:5000 tcp:5000" }, "forward-error"],
    [{ rules: "phone tcp:5000 tcp:8080" }, "forward-error"],
    [{ forwardFails: true }, "forward-error"],
    [{ unverifiedForward: true }, "forward-error"],
    [{ health: false }, "brain-unavailable"],
    [{ stalled: true }, "brain-unavailable"],
    [{ response: () => reply({ status: "ok" }) }, "brain-unavailable"],
    [
      {
        response: () =>
          new Response("{bad", {
            headers: { "content-type": "application/json" },
          }),
      },
      "brain-unavailable",
    ],
    [
      { response: () => new Response("server", { status: 503 }) },
      "brain-unavailable",
    ],
    [
      {
        response: () =>
          reply({
            service: "vidur-brain",
            status: "ok",
            extra: "x".repeat(5000),
          }),
      },
      "brain-unavailable",
    ],
    [{}, "connected"],
  ]) {
    const { state, monitor } = fixture(options);
    assert.equal(
      (await monitor.refresh()).state,
      expected,
      JSON.stringify(options),
    );
    if (
      [
        "disconnected",
        "unauthorized",
        "device-unavailable",
        "adb-missing",
        "unknown",
        "forward-error",
      ].includes(expected)
    )
      assert.equal(state.healthCalls, 0);
    monitor.stop();
  }
  const { state, monitor } = fixture();
  const pending = monitor.refresh();
  assert.equal(monitor.refresh(), pending); // One ADB/check pipeline at a time.
  await pending;
  await monitor.refresh();
  assert.equal(
    state.calls.filter((call) => call.args.includes("--no-rebind")).length,
    1,
  );
  assert.equal(state.changes.length, 1); // Identical snapshots do not flicker.
  state.health = false;
  assert.equal((await monitor.refresh()).state, "brain-unavailable");
  state.devices = "phone unauthorized";
  assert.equal((await monitor.refresh()).state, "unauthorized");
  state.devices = "";
  assert.equal((await monitor.refresh()).state, "disconnected");
  state.devices = "phone device";
  state.health = true;
  assert.equal((await monitor.refresh()).state, "connected");
  monitor.stop();
  const count = state.calls.length;
  await monitor.refresh();
  assert.equal(state.calls.length, count);

  const mock = fixture({ monitorOptions: { mode: "mock" } });
  assert.equal((await mock.monitor.refresh()).state, "mock");
  assert.equal(mock.state.calls.length, 0);
  const selected = fixture({
    devices: "other device\nphone device",
    monitorOptions: { env: { ANDROID_SERIAL: "phone" } },
  });
  assert.equal((await selected.monitor.refresh()).state, "connected");
  const absent = fixture({
    monitorOptions: { env: { ANDROID_SERIAL: "absent" } },
  });
  assert.equal((await absent.monitor.refresh()).state, "disconnected");
  const discovery = fixture({
    monitorOptions: {
      env: { DAEMON_ADB_PATH: "C:/Android/platform-tools/adb.exe" },
      exists: async () => true,
    },
  });
  assert.equal((await discovery.monitor.refresh()).state, "connected");
  assert.equal(
    discovery.state.calls[0].file,
    "C:/Android/platform-tools/adb.exe",
  );
  console.log(
    "Device status: authorization, selection/discovery, forwarding verification/conflicts, stopped Flask, health validation/timeouts, transitions, coalescing and mock isolation passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
