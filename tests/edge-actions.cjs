const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");
const {
  parseModelAction,
  SYSTEM_PROMPT,
  validateEndpoint,
  resolveEndpoint,
} = require("../electron/edge-llm.cjs");
const { actionDispatcher } = require("../electron/action-dispatcher.cjs");
const { ensureEdgeConnection } = require("../electron/edge-connection.cjs");
const { generate } = require("../electron/inference.cjs");

const completion = (content) => ({
  choices: [{ message: { role: "assistant", content } }],
});

(async () => {
  assert.ok(
    SYSTEM_PROMPT.length / 4 < 350,
    "system prompt should stay under ~350 tokens",
  );
  assert.equal(
    validateEndpoint("http://127.0.0.1:8080/v1/chat/completions"),
    "http://127.0.0.1:8080/v1/chat/completions",
  );
  assert.equal(
    validateEndpoint("http://192.168.1.20:8080/v1/chat/completions"),
    "http://192.168.1.20:8080/v1/chat/completions",
  );
  assert.throws(() => validateEndpoint("http://example.com:8080/v1/chat/completions"));
  assert.throws(() => validateEndpoint("https://127.0.0.1:8080/v1/chat/completions"));
  const previous = process.env.DAEMON_LLM_ENDPOINT;
  process.env.DAEMON_LLM_ENDPOINT = "http://10.0.0.8:8080/v1/chat/completions";
  assert.equal(
    resolveEndpoint("http://127.0.0.1:8080/v1/chat/completions"),
    "http://10.0.0.8:8080/v1/chat/completions",
  );
  if (previous === undefined) delete process.env.DAEMON_LLM_ENDPOINT;
  else process.env.DAEMON_LLM_ENDPOINT = previous;

  assert.deepEqual(parseModelAction('{"action":"chat","reply":"Hello"}'), {
    action: "chat",
    reply: "Hello",
  });
  const fenced = parseModelAction(
    '```json\n{"action":"code","filename":"../../secret.py","content":"print(1)\\n"}\n```',
  );
  assert.equal(fenced.action, "code");
  assert.equal(fenced.filename, "../../secret.py");
  assert.equal(fenced.content, "print(1)\n");
  assert.deepEqual(
    parseModelAction(
      'Sure, here you go: {"action":"essay","title":"Rivers","content":"Water moves.","reply":"Done"} trailing',
    ).action,
    "essay",
  );
  const messy = parseModelAction("I could not decide, so this is plain text.");
  assert.deepEqual(messy, {
    action: "chat",
    reply: "I could not decide, so this is plain text.",
  });
  assert.equal(
    parseModelAction('{"action":"chat","reply":"nested {brace} ok"}').reply,
    "nested {brace} ok",
  );

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vidur-hands-"));
  const opened = [];
  const openFile = async (kind, filePath) => {
    opened.push({ kind, filePath });
  };
  const chat = await actionDispatcher(
    { action: "chat", reply: "Just talking." },
    { workspace: root, openFile },
  );
  assert.equal(chat.reply, "Just talking.");
  assert.equal(chat.file, undefined);

  const code = await actionDispatcher(
    { action: "code", filename: "../../secret.py", content: "print('hi')\n" },
    { workspace: root, openFile },
  );
  assert.equal(code.file.name, "secret.py");
  assert.equal(code.file.kind, "code");
  assert.equal(
    await fs.readFile(code.file.workspacePath, "utf8"),
    "print('hi')\n",
  );
  assert.equal(path.dirname(code.file.workspacePath), path.join(root, "code"));
  assert.equal(opened.at(-1).kind, "code");
  assert.match(code.reply, /secret\.py/);

  const deck = await actionDispatcher(
    {
      action: "ppt",
      title: "Edge notes",
      reply: "Three slides are ready.",
      slides: [
        { heading: "Why", bullets: ["Local model", "Desktop hands"] },
        { heading: "How", bullets: ["JSON in", "Files out"] },
      ],
    },
    { workspace: root, openFile },
  );
  assert.equal(deck.file.extension, ".pptx");
  assert.equal(opened.at(-1).kind, "ppt");
  const zip = await JSZip.loadAsync(await fs.readFile(deck.file.workspacePath));
  const slides = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  );
  assert.equal(slides.length, 2);
  assert.match(deck.reply, /Three slides are ready/);
  assert.match(deck.file.content, /## Why/);

  const essay = await actionDispatcher(
    {
      action: "essay",
      title: "Morning rivers",
      content: "The water was cold.",
      reply: "Saved the essay.",
    },
    { workspace: root, openFile },
  );
  assert.equal(essay.file.name, "Morning_rivers.md");
  assert.match(await fs.readFile(essay.file.workspacePath, "utf8"), /# Morning rivers/);
  assert.equal(path.dirname(essay.file.workspacePath), path.join(root, "docs"));
  assert.equal(opened.at(-1).kind, "essay");

  const generated = await generate("Say hello", {
    workspaceRoot: root,
    openFile,
    fetchImpl: async () =>
      new Response(
        JSON.stringify(
          completion('```json\n{"action":"chat","reply":"Hello from the phone"}\n```'),
        ),
        { headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(generated.reply, "Hello from the phone");
  assert.equal(generated.file, undefined);

  const generatedCode = await generate("Write a script", {
    workspaceRoot: root,
    openFile,
    fetchImpl: async () =>
      new Response(
        JSON.stringify(
          completion(
            '{"action":"code","filename":"add.js","content":"export const add = (a, b) => a + b;\\n"}',
          ),
        ),
        { headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(generatedCode.file.name, "add.js");
  assert.match(generatedCode.file.content, /export const add/);

  let adbCalls = [];
  const down = await ensureEdgeConnection({
    endpoint: "http://127.0.0.1:8080/v1/chat/completions",
    fetchImpl: async () => {
      throw new TypeError("down");
    },
    run: async (file, args) => {
      adbCalls.push({ file, args });
      if (args[0] === "forward" && args[1] === "--list") return { stdout: "" };
      if (args[0] === "forward") return { stdout: "" };
      throw new Error("unexpected");
    },
  });
  assert.equal(down.reachable, false);
  assert.equal(down.forwarded, true);
  assert.deepEqual(adbCalls[1].args, ["forward", "tcp:8080", "tcp:8080"]);

  adbCalls = [];
  const up = await ensureEdgeConnection({
    endpoint: "http://192.168.1.9:8080/v1/chat/completions",
    fetchImpl: async () => new Response("{}", { status: 200 }),
    run: async () => {
      adbCalls.push("should-not-run");
      return { stdout: "" };
    },
  });
  assert.equal(up.reachable, true);
  assert.equal(adbCalls.length, 0);

  const missing = await ensureEdgeConnection({
    endpoint: "http://127.0.0.1:8080/v1/chat/completions",
    fetchImpl: async () => new Response("no", { status: 500 }),
    run: async () => {
      const error = new Error("no adb");
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.equal(missing.adb, "missing");
  assert.equal(missing.reachable, false);

  console.log(
    "Edge actions: compact prompt, JSON recovery, chat/code/ppt/essay dispatch, and adb forward helper passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
