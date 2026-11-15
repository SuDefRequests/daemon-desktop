const { execFile } = require("node:child_process");
const { healthUrlFor } = require("./edge-llm.cjs");

function probe(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: controller.signal,
    headers: { Accept: "application/json" },
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => clearTimeout(timer));
}

function runCommand(run, file, args) {
  return run(file, args, {
    timeout: 4000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
    shell: false,
  });
}

/**
 * Confirm the edge llama-server is reachable. For loopback, set up
 * `adb forward tcp:<port> tcp:<port>` when adb is installed and the
 * forward is missing. A missing phone or adb does not throw.
 */
async function ensureEdgeConnection({
  endpoint,
  fetchImpl = globalThis.fetch,
  run = (file, args, options) =>
    new Promise((resolve, reject) => {
      execFile(file, args, options, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    }),
  timeoutMs = 1500,
} = {}) {
  const health = healthUrlFor(endpoint);
  const target = new URL(health);
  if (await probe(health, fetchImpl, timeoutMs))
    return { reachable: true, forwarded: false, health };
  const loopback =
    target.hostname === "127.0.0.1" || target.hostname === "localhost";
  let forwarded = false;
  let adb = "unavailable";
  if (loopback) {
    const port = target.port;
    const rule = `tcp:${port}`;
    try {
      const listed = await runCommand(run, "adb", ["forward", "--list"]);
      const present = String(listed.stdout || "")
        .split(/\r?\n/)
        .some((line) => {
          const parts = line.trim().split(/\s+/);
          return parts[1] === rule && parts[2] === rule;
        });
      if (!present) {
        await runCommand(run, "adb", ["forward", rule, rule]);
        forwarded = true;
      }
      adb = present ? "already-forwarded" : "forwarded";
    } catch (error) {
      adb = error.code === "ENOENT" ? "missing" : "failed";
    }
  }
  return {
    reachable: await probe(health, fetchImpl, timeoutMs),
    forwarded,
    adb,
    health,
  };
}

module.exports = { ensureEdgeConnection };
