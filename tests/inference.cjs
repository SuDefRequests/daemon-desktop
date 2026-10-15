const assert = require("node:assert/strict");
const {
  generate,
  convertResponse,
  providerMode,
  ENDPOINT,
  INFERENCE_TIMEOUT_MS,
  MAX_PROMPT_LENGTH,
} = require("../electron/inference.cjs");
const payload = (action, content) => ({
  action,
  content,
  filename: "../../untrusted.docx",
});
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
(async () => {
  assert.equal(providerMode(), "mock");
  assert.equal(providerMode("android"), "android");
  assert.throws(() => providerMode("other"));
  assert.equal(INFERENCE_TIMEOUT_MS, 600000);
  assert.deepEqual(
    convertResponse({ action: "chat", content: "Hello, Suraj!", filename: "" }),
    { reply: "Hello, Suraj!" },
  );
  assert.equal(providerMode("mock"), "mock");
  for (const content of [
    "Error: AI timed out.",
    "Error: llama-server not running.",
  ])
    assert.throws(
      () => convertResponse({ action: "chat", content, filename: "" }),
      /Android brain/,
    );
  assert.deepEqual(
    await generate("Hello", {
      fetchImpl: async () =>
        json({ action: "chat", content: "Hi!", filename: "" }),
    }),
    { reply: "Hi!" },
  );
  const cases = [
    ["automate_vscode", 'print("Hello")', ".py", "code"],
    ["automate_notepad", "Meeting notes", ".txt", "document"],
    ["automate_notepad", "**Meeting notes**", ".md", "document"],
    ["automate_excel", "Item,Price\nNotebook,5", ".csv", "spreadsheet"],
    ["automate_word", "Project description", ".txt", "document"],
    ["automate_word", "# Project\n\n- Plan", ".md", "document"],
    [
      "automate_ppt",
      "Introduction. Main points. Conclusion.",
      ".txt",
      "presentation",
    ],
    ["automate_ppt", "# Slide 1\n\n- Idea", ".md", "presentation"],
  ];
  for (const [action, content, extension, kind] of cases) {
    const result = convertResponse(payload(action, content));
    assert.equal(result.file.extension, extension);
    assert.equal(result.file.kind, kind);
    assert.equal(result.file.content, content);
    assert.equal(result.file.name, undefined);
  }
  assert.equal(
    convertResponse(payload("automate_canva", "project poster")).file,
    undefined,
  );
  assert.match(
    convertResponse(payload("automate_canva", "project poster")).reply,
    /not supported/,
  );
  assert.equal(
    convertResponse(payload("automate_vscode", "```python\nprint(1)\n```")).file
      .content,
    "print(1)",
  );
  assert.equal(
    convertResponse(payload("automate_excel", '```csv\nA,B\n"one,two",3\n```'))
      .file.extension,
    ".csv",
  );
  assert.throws(
    () => convertResponse(payload("automate_excel", "A,B\n1,2,3")),
    /consistent CSV/,
  );
  assert.throws(
    () => convertResponse(payload("automate_excel", 'A,B\n"broken,2')),
    /consistent CSV/,
  );
  assert.throws(
    () =>
      convertResponse(
        payload("automate_vscode", "```javascript\nalert(1)\n```"),
      ),
    /unsupported code fencing/,
  );
  assert.throws(
    () => convertResponse(payload("automate_vscode", "```python\n\n```")),
    /Python response is empty/,
  );
  for (const field of ["action", "content", "filename"]) {
    const incomplete = payload("automate_word", "text");
    delete incomplete[field];
    assert.throws(() => convertResponse(incomplete), /Invalid brain response/);
  }
  for (const value of [
    null,
    [],
    {},
    payload("unknown", "content"),
    { action: "automate_word", content: "text" },
    { action: "automate_word", filename: "x", content: 3 },
    payload("automate_word", ""),
    payload("automate_word", "\0"),
    payload("automate_word", "x".repeat(2000001)),
  ])
    assert.throws(() => convertResponse(value));
  for (const content of [
    "Error: AI timed out.",
    "  error: llama-server not running.",
    "Error: Blank output from Qwen.",
  ])
    await assert.rejects(
      generate("hello", {
        fetchImpl: async () => json(payload("automate_word", content)),
      }),
      /Android brain/,
    );
  // Ordinary prose containing the word Error is not a backend failure.
  assert.ok(
    convertResponse(payload("automate_word", "Error handling is useful.")).file,
  );
  let request;
  const result = await generate("  Write code  ", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return json(payload("automate_vscode", "print(1)"));
    },
  });
  assert.equal(result.file.extension, ".py");
  assert.equal(request.url, ENDPOINT);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.redirect, "error");
  assert.deepEqual(JSON.parse(request.options.body), { prompt: "Write code" });
  for (const prompt of [
    "",
    " ",
    null,
    {},
    "x".repeat(MAX_PROMPT_LENGTH + 1),
    "hello\0",
  ])
    await assert.rejects(
      generate(prompt, {
        fetchImpl: async () => {
          throw new Error("Must not fetch");
        },
      }),
      /Prompt must/,
    );
  await assert.rejects(
    generate("hello", {
      fetchImpl: async () =>
        new Response("{bad", {
          headers: { "content-type": "application/json" },
        }),
    }),
    /malformed JSON/,
  );
  await assert.rejects(
    generate("hello", { fetchImpl: async () => new Response("html") }),
    /not JSON/,
  );
  await assert.rejects(
    generate("hello", {
      fetchImpl: async () => new Response("failure", { status: 503 }),
    }),
    /HTTP error/,
  );
  await assert.rejects(
    generate("hello", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }),
    /Cannot reach/,
  );
  await assert.rejects(
    generate("hello", {
      fetchImpl: async () => {
        throw Object.assign(new Error("cross-realm fixture"), {
          name: "TypeError",
        });
      },
    }),
    /Cannot reach/,
  );
  let aborted = false;
  await assert.rejects(
    generate("hello", {
      timeoutMs: 20,
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          ),
        ),
    }),
    /timed out/,
  );
  assert.equal(aborted, true);
  await assert.rejects(
    generate("hello", {
      fetchImpl: async () =>
        new Response("x", {
          headers: {
            "content-type": "application/json",
            "content-length": "2100001",
          },
        }),
    }),
    /too large/,
  );
  await assert.rejects(
    generate("hello", {
      fetchImpl: async () =>
        new Response("x".repeat(2100001), {
          headers: { "content-type": "application/json" },
        }),
    }),
    /too large/,
  );
  // The timeout covers response-body reading as well as the initial connection.
  await assert.rejects(
    generate("hello", {
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener(
                "abort",
                () =>
                  controller.error(
                    Object.assign(new Error("Aborted"), { name: "AbortError" }),
                  ),
                { once: true },
              );
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    }),
    /timed out/,
  );
  console.log(
    "Inference: fixed endpoint, prompt/response validation, all actions, truthful formats, JSON/HTTP/application/network errors, bounded bodies and connection/body timeouts passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
