import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";

let vite,
  desktop,
  stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  desktop?.kill();
  await vite?.close();
  process.exitCode = code;
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
try {
  // Vite owns port selection: never probe, reuse unknown servers or kill processes.
  vite = await createServer({
    server: { host: "127.0.0.1", port: 5173, strictPort: false },
  });
  await vite.listen();
  const url = vite.resolvedUrls.local[0];
  if (!url) throw new Error("Vite did not resolve a local development URL.");
  console.log(`DAEMON development server: ${url}`);
  desktop = spawn(electron, ["."], {
    stdio: "inherit",
    env: {
      ...process.env,
      DAEMON_DEV: "1",
      DAEMON_DEV_URL: url,
      DAEMON_PROVIDER: process.env.DAEMON_PROVIDER ?? "android",
    },
  });
  desktop.on("error", (error) => {
    console.error(`Cannot launch DAEMON: ${error.message}`);
    void stop(1);
  });
  desktop.on("exit", (code) => void stop(code ?? 1));
} catch (error) {
  console.error(
    `DAEMON development startup failed (preferred port 5173): ${error.message}`,
  );
  await stop(1);
}
