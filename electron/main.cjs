const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { writeArtifact } = require("./artifact-files.cjs");
const inference = require("./inference.cjs");
let win, outputDirectory;
let workspace = { conversations: [], artifacts: [] };
let queue = Promise.resolve();
function serialize(fn) {
  const operation = queue.catch(() => {}).then(fn);
  queue = operation;
  return operation;
}
const dataFile = () => path.join(app.getPath("userData"), "workspace.json");
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
  await fs.rename(file + ".tmp", file);
}
function trusted(event) {
  if (
    event.sender !== win?.webContents ||
    event.senderFrame !== win.webContents.mainFrame
  )
    throw new Error("Untrusted IPC sender");
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    return fn(...args);
  });
}
function validArtifact(a) {
  if (
    !a ||
    typeof a.id !== "string" ||
    !/^[\w-]{1,100}$/.test(a.id) ||
    typeof a.name !== "string" ||
    !/^[\w.-]+\.(md|csv|py|txt)$/.test(a.name) ||
    a.name.length > 180 ||
    typeof a.content !== "string" ||
    a.content.length > 2_000_000
  )
    throw new Error("Invalid artifact");
}
function validWorkspace(data) {
  if (
    !data ||
    !Array.isArray(data.conversations) ||
    !Array.isArray(data.artifacts) ||
    JSON.stringify(data).length > 20_000_000
  )
    throw new Error("Invalid workspace");
  for (const c of data.conversations) {
    if (
      typeof c.id !== "string" ||
      typeof c.title !== "string" ||
      typeof c.updatedAt !== "string" ||
      !Array.isArray(c.messages)
    )
      throw new Error("Invalid conversation");
    for (const m of c.messages)
      if (
        typeof m.id !== "string" ||
        !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string"
      )
        throw new Error("Invalid message");
  }
  data.artifacts.forEach(validArtifact);
}
async function managedPath(id) {
  const a = workspace.artifacts.find((a) => a.id === id);
  if (!a?.path) throw new Error("File not found");
  const actual = await fs.realpath(a.path);
  const basename = path.basename(a.path);
  if (
    actual !== path.resolve(a.path) ||
    (basename !== a.name && basename !== `${a.id}-${a.name}`)
  )
    throw new Error("File path rejected");
  return actual;
}
app.whenReady().then(async () => {
  const mode = inference.providerMode(process.env.DAEMON_PROVIDER || "mock");
  let generating = false;
  handle("inference:config", () => ({ provider: mode }));
  handle("inference:generate", async (prompt) => {
    inference.validatePrompt(prompt);
    if (mode !== "android")
      throw new Error("Real inference is disabled in mock mode.");
    if (generating)
      throw new Error("An Android inference request is already in progress.");
    generating = true;
    try {
      return await inference.generate(prompt);
    } finally {
      generating = false;
    }
  });
  outputDirectory =
    process.env.DAEMON_SAVE_DIR ||
    path.join(app.getPath("documents"), "DAEMON");
  try {
    const settings = JSON.parse(await fs.readFile(settingsFile(), "utf8"));
    if (typeof settings.outputDirectory === "string")
      outputDirectory = settings.outputDirectory;
  } catch (e) {
    if (e.code !== "ENOENT")
      console.error("Unable to load settings:", e.message);
  }
  let loadError;
  try {
    const saved = JSON.parse(await fs.readFile(dataFile(), "utf8"));
    validWorkspace(saved);
    // Preserve legacy files on disk, but show their real basename consistently.
    saved.artifacts = saved.artifacts.map((a) =>
      a.path ? { ...a, name: path.basename(a.path) } : a,
    );
    workspace = saved;
  } catch (e) {
    if (e.code !== "ENOENT")
      loadError = "Unable to load saved history. Original file preserved.";
  }
  handle("workspace:load", () => {
    if (loadError) throw new Error(loadError);
    return workspace;
  });
  handle("workspace:save", (data) => {
    if (loadError) throw new Error(loadError);
    validWorkspace(data);
    return serialize(async () => {
      const registered = new Map(workspace.artifacts.map((a) => [a.id, a]));
      const sanitized = {
        ...data,
        artifacts: data.artifacts.map(
          (a) => registered.get(a.id) || { ...a, path: undefined },
        ),
      };
      await atomicWrite(dataFile(), sanitized);
      workspace = sanitized;
    });
  });
  handle("artifact:save", (a) => {
    if (loadError) throw new Error(loadError);
    validArtifact(a);
    return serialize(async () => {
      const saved = await writeArtifact(outputDirectory, a);
      const next = { ...workspace, artifacts: [...workspace.artifacts, saved] };
      await atomicWrite(dataFile(), next);
      workspace = next;
      return saved;
    });
  });
  handle("artifact:open", async (id) => {
    const target = await managedPath(id);
    if (path.extname(target).toLowerCase() === ".py")
      throw new Error(
        "Python source cannot be opened with the system association because it could execute code. Use Preview or Show in folder.",
      );
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  handle("artifact:reveal", async (id) =>
    shell.showItemInFolder(await managedPath(id)),
  );
  handle("output:get", () => outputDirectory);
  handle("output:choose", async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    const chosen = result.filePaths[0];
    await atomicWrite(settingsFile(), { outputDirectory: chosen });
    outputDirectory = chosen;
    return chosen;
  });
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 850,
    minHeight: 650,
    backgroundColor: "#111315",
    title: "DAEMON",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  if (process.env.DAEMON_DEV === "1")
    await win.loadURL("http://127.0.0.1:5173");
  else await win.loadFile(path.join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) (app.relaunch(), app.exit());
});
