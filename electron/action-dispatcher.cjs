const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CODE_EXTENSIONS } = require("./code-languages.cjs");

const CODE_ALIAS = {
  ".py": ".py",
  ".js": ".js",
  ".mjs": ".js",
  ".cjs": ".js",
  ".jsx": ".js",
  ".ts": ".ts",
  ".tsx": ".ts",
  ".c": ".c",
  ".h": ".c",
  ".cpp": ".cpp",
  ".cc": ".cpp",
  ".cxx": ".cpp",
  ".hpp": ".cpp",
  ".java": ".java",
  ".html": ".html",
  ".htm": ".html",
  ".css": ".css",
  ".rs": ".rs",
  ".go": ".go",
  ".sh": ".sh",
  ".bash": ".sh",
};

function workspaceRoot(root) {
  return root || path.join(os.homedir(), "ai-workspace");
}

function stem(value, fallback) {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
    .replace(/_+$/g, "");
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned))
    return fallback;
  return cleaned;
}

function codeName(filename) {
  const base = path.basename(String(filename || "snippet.txt"));
  const extension = path.extname(base).toLowerCase();
  const mapped = CODE_ALIAS[extension];
  const safe = stem(base.slice(0, base.length - extension.length), "snippet");
  if (mapped && CODE_EXTENSIONS.has(mapped)) return `${safe}${mapped}`;
  return `${safe}.txt`;
}

async function allocate(directory, filename) {
  await fs.mkdir(directory, { recursive: true });
  const extension = path.extname(filename);
  const nameStem = filename.slice(0, -extension.length);
  for (let index = 1; index <= 1000; index++) {
    const name = index === 1 ? filename : `${nameStem}_${index}${extension}`;
    const target = path.join(directory, name);
    try {
      const handle = await fs.open(target, "wx", 0o600);
      await handle.close();
      return { name, target };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate a unique filename.");
}

function defaultOpen(kind, filePath) {
  const options = { timeout: 8000, windowsHide: true, shell: false };
  if (kind === "code" && CODE_EXTENSIONS.has(path.extname(filePath)))
    return execFileAsync("code", ["--reuse-window", "--", filePath], options);
  if (process.platform === "darwin")
    return execFileAsync("open", [filePath], options);
  if (process.platform === "win32")
    return execFileAsync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/c", "start", "", filePath],
      options,
    );
  return execFileAsync("xdg-open", [filePath], options);
}

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function slideScript(title, slides) {
  return [`# ${title}`, ...slides.map((slide) => {
    const bullets = slide.bullets.map((bullet) => `- ${bullet}`).join("\n");
    return `## ${slide.heading}${bullets ? `\n\n${bullets}` : ""}`;
  })].join("\n\n");
}

async function writePresentation(target, title, slides) {
  const PptxGenJS = require("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "VIDUR AI";
  deck.title = title;
  deck.subject = "Presentation from the edge model";
  for (const slide of slides) {
    const page = deck.addSlide();
    page.background = { color: "F7F8FA" };
    page.addText(slide.heading, {
      x: 0.6,
      y: 0.42,
      w: 12,
      h: 1,
      fontSize: 30,
      bold: true,
      color: "20262D",
      margin: 0,
    });
    if (slide.bullets.length) {
      page.addText(
        slide.bullets.map((bullet) => ({
          text: bullet,
          options: { bullet: true, breakLine: true },
        })),
        {
          x: 0.75,
          y: 1.7,
          w: 11.6,
          h: 5,
          fontSize: 20,
          color: "303945",
          paraSpaceAfter: 10,
        },
      );
    }
  }
  const buffer = await deck.write({ outputType: "nodebuffer", compression: true });
  await fs.writeFile(target, buffer);
  return buffer;
}

async function actionDispatcher(
  action,
  {
    workspace = workspaceRoot(),
    openFile = defaultOpen,
  } = {},
) {
  if (!action || action.action === "chat")
    return { reply: action?.reply || "The model returned an empty response." };

  if (action.action === "code") {
    const filename = codeName(action.filename);
    const kind = filename.endsWith(".txt") ? "document" : "code";
    const folder = path.join(workspace, kind === "code" ? "code" : "docs");
    const allocated = await allocate(folder, filename);
    await fs.writeFile(allocated.target, action.content, "utf8");
    const opened = await openSaved(kind === "code" ? "code" : "essay", allocated.target, openFile);
    const where = kind === "code" ? "VS Code" : "the default editor";
    return {
      reply: `Saved ${allocated.name} to ${allocated.target}.${opened.note} ${opened.ok ? `Opened it in ${where}.` : ""}`.trim(),
      file: {
        kind,
        extension: path.extname(allocated.name),
        name: allocated.name,
        content: action.content,
        workspacePath: allocated.target,
        opened: opened.ok,
      },
    };
  }

  if (action.action === "ppt") {
    const filename = `${stem(action.title, "presentation")}.pptx`;
    const folder = path.join(workspace, "presentations");
    const allocated = await allocate(folder, filename);
    await writePresentation(allocated.target, action.title, action.slides);
    const opened = await openSaved("ppt", allocated.target, openFile);
    const note = action.reply ? `${action.reply.trim()} ` : "";
    return {
      reply: `${note}Saved the presentation to ${allocated.target}.${opened.note}`.trim(),
      file: {
        kind: "presentation",
        extension: ".pptx",
        name: allocated.name,
        content: slideScript(action.title, action.slides),
        presentationStatus: "complete",
        workspacePath: allocated.target,
        opened: opened.ok,
      },
    };
  }

  if (action.action === "essay") {
    const filename = `${stem(action.title, "document")}.md`;
    const folder = path.join(workspace, "docs");
    const allocated = await allocate(folder, filename);
    const content = action.content.startsWith("# ")
      ? action.content
      : `# ${action.title}\n\n${action.content}`;
    await fs.writeFile(allocated.target, content, "utf8");
    const opened = await openSaved("essay", allocated.target, openFile);
    const note = action.reply ? `${action.reply.trim()} ` : "";
    return {
      reply: `${note}Saved the document to ${allocated.target}.${opened.note}`.trim(),
      file: {
        kind: "document",
        extension: ".md",
        name: allocated.name,
        content,
        workspacePath: allocated.target,
        opened: opened.ok,
      },
    };
  }

  return {
    action: "chat",
    reply:
      typeof action.reply === "string"
        ? action.reply
        : "The model returned an unsupported action.",
  };
}

async function openSaved(kind, filePath, openFile) {
  try {
    await openFile(kind, filePath);
    return { ok: true, note: "" };
  } catch (error) {
    return {
      ok: false,
      note: ` Could not open it automatically: ${error.message}`,
    };
  }
}

module.exports = { actionDispatcher, codeName, workspaceRoot };
