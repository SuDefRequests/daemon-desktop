const ENDPOINT = "http://127.0.0.1:5000/process";
const INFERENCE_TIMEOUT_MS = 600_000;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_RESPONSE_BYTES = 2_100_000;
const actions = new Set([
  "chat",
  "automate_vscode",
  "automate_notepad",
  "automate_excel",
  "automate_word",
  "automate_ppt",
  "automate_canva",
]);

function providerMode(value = "mock") {
  if (!["mock", "android"].includes(value))
    throw new Error("DAEMON_PROVIDER must be mock or android.");
  return value;
}
function validatePrompt(prompt) {
  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    prompt.length > MAX_PROMPT_LENGTH ||
    prompt.includes("\0")
  )
    throw new Error(
      `Prompt must contain 1–${MAX_PROMPT_LENGTH} characters, without null bytes.`,
    );
  return prompt.trim();
}
function validateResponse(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.action !== "string" ||
    !actions.has(data.action) ||
    typeof data.filename !== "string" ||
    data.filename.length > 512 ||
    typeof data.content !== "string"
  )
    throw new Error(
      "Invalid brain response: expected a supported action, content and filename.",
    );
  if (!data.content.trim())
    throw new Error("The Android brain returned empty content.");
  if (data.content.length > 2_000_000 || data.content.includes("\0"))
    throw new Error("The Android brain returned invalid or oversized content.");
  if (/^\s*error\s*:/i.test(data.content))
    throw new Error(`Android brain: ${data.content.trim().slice(0, 500)}`);
  return data;
}
function unwrapFence(content, languages) {
  const match = content.trim().match(/^```([^\n]*)\n([\s\S]*?)\n```$/);
  return match && languages.includes(match[1].trim().toLowerCase())
    ? match[2]
    : content;
}
function isCSV(content) {
  let quoted = false,
    afterQuote = false,
    fieldStart = true,
    fields = 1,
    row = "",
    rows = [];
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      row += ch;
      if (ch === '"') {
        if (content[i + 1] === '"') {
          row += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      }
      continue;
    }
    if (ch === '"') {
      if (!fieldStart) return false;
      quoted = true;
      fieldStart = false;
      row += ch;
      continue;
    }
    if (ch === ",") {
      fields++;
      fieldStart = true;
      afterQuote = false;
      row += ch;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      if (row.trim()) rows.push(fields);
      fields = 1;
      row = "";
      fieldStart = true;
      afterQuote = false;
      continue;
    }
    if (afterQuote && ch !== " " && ch !== "\t") return false;
    fieldStart = false;
    row += ch;
  }
  if (quoted) return false;
  if (row.trim()) rows.push(fields);
  return (
    rows.length > 0 && rows[0] >= 2 && rows.every((count) => count === rows[0])
  );
}
function convertResponse(response) {
  const { action, content } = validateResponse(response);
  if (action === "chat") return { reply: content };
  if (action === "automate_canva")
    return {
      reply: `The brain returned a Canva search phrase:\n\n${content}\n\nCanva automation is not supported in this foundation. No file was created and no browser was opened.`,
    };
  let kind,
    extension,
    text = content;
  if (action === "automate_vscode") {
    kind = "code";
    extension = ".py";
    text = unwrapFence(content, ["python", "py", ""]);
    if (!text.trim())
      throw new Error("Python response is empty. No file was saved.");
    if (/^\s*```/.test(text))
      throw new Error(
        "Python response has unsupported code fencing. No file was saved.",
      );
  } else if (action === "automate_excel") {
    kind = "spreadsheet";
    extension = ".csv";
    text = unwrapFence(content, ["csv", ""]);
    if (!isCSV(text))
      throw new Error(
        "Spreadsheet response is not consistent CSV data. No file was saved.",
      );
  } else {
    kind = action === "automate_ppt" ? "presentation" : "document";
    extension =
      /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)/.test(
        content,
      )
        ? ".md"
        : ".txt";
  }
  const limitation =
    action === "automate_ppt"
      ? " This is presentation text, not a PowerPoint deck."
      : action === "automate_word"
        ? " This is text, not a Word document."
        : action === "automate_excel"
          ? " This is CSV data, not an Excel workbook."
          : "";
  return {
    reply: `The Android brain returned content for a ${extension} file.${limitation} Review the artifact before use.`,
    file: { kind, extension, content: text },
  };
}

async function generate(
  prompt,
  { fetchImpl = globalThis.fetch, timeoutMs = INFERENCE_TIMEOUT_MS } = {},
) {
  const valid = validatePrompt(prompt);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader, response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ prompt: valid }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Android brain HTTP error (${response.status}).`);
    if (
      !/^application\/json(?:\s*;|\s*$)/i.test(
        response.headers.get("content-type") || "",
      )
    )
      throw new Error("Android brain response is not JSON.");
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES)
      throw new Error("Android brain response is too large.");
    reader = response.body?.getReader();
    if (!reader) throw new Error("Android brain returned no response body.");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new Error("Android brain response is too large.");
      chunks.push(Buffer.from(value));
    }
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Android brain returned malformed JSON.");
    }
    return convertResponse(parsed);
  } catch (error) {
    if (
      controller.signal.aborted ||
      error.name === "AbortError" ||
      error.name === "TimeoutError"
    )
      throw new Error(
        "Android inference timed out. Check the phone and try again.",
      );
    if (error instanceof TypeError || error.name === "TypeError")
      throw new Error(
        "Cannot reach the Android brain. Check USB authorization, ADB forwarding and the phone services.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => {});
    else if (response?.body) await response.body.cancel().catch(() => {});
  }
}
module.exports = {
  generate,
  providerMode,
  validatePrompt,
  validateResponse,
  convertResponse,
  isCSV,
  ENDPOINT,
  INFERENCE_TIMEOUT_MS,
  MAX_PROMPT_LENGTH,
};
