import { spawn } from "node:child_process";
import { createServer } from "node:net";
import electron from "electron";
const probe = createServer();
try {
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(5173, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
} catch {
  console.error(
    "Port 5173 is in use. Stop npm run dev before launching Electron.",
  );
  process.exit(1);
}
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { stdio: "inherit" },
);
let desktop;
const stop = () => {
  desktop?.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", (code) => {
  if (!desktop) process.exit(code || 1);
});
try {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch("http://127.0.0.1:5173");
      if (r.ok) break;
    } catch {}
    if (i === 149) throw new Error("Vite did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  desktop = spawn(electron, ["."], {
    stdio: "inherit",
    env: { ...process.env, DAEMON_DEV: "1" },
  });
  desktop.on("exit", (code) => {
    vite.kill();
    process.exit(code || 0);
  });
} catch (e) {
  console.error(e);
  stop();
  process.exit(1);
}
