// Compact prompt for Qwen2.5-Coder-1.5B on a phone CPU. Keep this short:
// the whole instruction is well under 350 tokens so prefill stays fast.
const SYSTEM_PROMPT = [
  "You control a desktop assistant. Return one JSON object and nothing else.",
  '{"action":"chat","reply":"<your full answer>"}',
  '{"action":"code","filename":"name.ext","content":"<full source code>"}',
  '{"action":"ppt","title":"<title>","slides":[{"heading":"<heading>","bullets":["<point>"]}],"reply":"<note>"}',
  '{"action":"essay","title":"<title>","content":"<complete essay text>","reply":"<note>"}',
  "Replace every <placeholder> with real content. Never output a placeholder or the word text as the answer.",
  "Use code for programs, ppt for slide decks, essay for essays or documents, otherwise chat.",
  "Escape quotes and newlines inside strings. No markdown fences.",
].join("\n");

const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1/chat/completions";
const API_KEY = "local-brain";
const MODEL = "Qwen2.5-Coder-1.5B-Instruct";

function isPrivateHost(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

function validateEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Edge LLM endpoint must be an http URL.");
  }
  if (url.protocol !== "http:")
    throw new Error("Edge LLM endpoint must use http.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Edge LLM endpoint cannot include credentials or a query.");
  if (!url.port) throw new Error("Edge LLM endpoint must include a port.");
  if (!isPrivateHost(url.hostname))
    throw new Error(
      "Edge LLM endpoint must be localhost or a private LAN address.",
    );
  if (url.pathname.replace(/\/$/, "") !== "/v1/chat/completions")
    throw new Error(
      "Edge LLM endpoint path must be /v1/chat/completions.",
    );
  return url.toString();
}

function resolveEndpoint(saved) {
  const env = process.env.DAEMON_LLM_ENDPOINT;
  if (env) return validateEndpoint(env);
  if (typeof saved === "string" && saved.trim()) {
    try {
      return validateEndpoint(saved);
    } catch {
      // Ignore a stale saved value and use the USB default.
    }
  }
  return validateEndpoint(DEFAULT_ENDPOINT);
}

function buildChatRequest(prompt) {
  return {
    model: MODEL,
    temperature: 0.2,
    repeat_penalty: 1.15, // same guard the workbench brain uses; without it
    // the 1.5B model falls into sentence repetition loops.
    stream: false,
    max_tokens: 1536,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  };
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === "string" ? part : part?.text || part?.content || "",
      )
      .join("");
  return "";
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function asString(value, limit) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\0/g, "");
  if (!text.trim() || text.length > limit) return null;
  return text;
}

const STUB_WORDS = new Set([
  "text",
  "essay",
  "document",
  "content",
  "title",
  "here",
  "goes",
  "placeholder",
  "sample",
  "example",
  "write",
  "about",
  "topic",
  "insert",
  "your",
  "lorem",
  "ipsum",
  "todo",
  "tbd",
]);
// Tiny edge models occasionally emit degenerate stubs ("content": "text").
// Reject anything that is almost entirely filler words instead of saving it.
function isStubContent(text) {
  const stripped = String(text || "")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length >= 8) return false;
  return !words.length || words.every((word) => STUB_WORDS.has(word));
}

// ...or fall into a repetition loop ("The moons are also known for their
// size..." x50). Flag any sentence that repeats itself more than a couple
// of times — real prose never does that.
function isRepetitiveLoop(text) {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, ""))
    .filter((s) => s.split(/\s+/).length >= 4);
  if (sentences.length < 4) return false;
  const counts = new Map();
  let max = 0;
  for (const sentence of sentences) {
    const n = (counts.get(sentence) || 0) + 1;
    counts.set(sentence, n);
    if (n > max) max = n;
  }
  return max >= 4;
}

function isDegenerate(text) {
  return isStubContent(text) || isRepetitiveLoop(text);
}

const DEGENERATE_REPLY =
  "The model returned a repetitive or empty answer. Try rephrasing your prompt.";

// Models sometimes wrap notes in <note>…</note>; the tag itself is noise.
function cleanReply(value) {
  return String(value || "")
    .replace(/<\/?note(?:\s[^>]*)?>/gi, "")
    .trim();
}

function normalizeAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.action === "chat") {
    const reply = asString(cleanReply(value.reply), 20_000);
    if (!reply) return null;
    // Degenerate answers ("text", "essay"…, sentence loops) get an honest
    // error, not a meaningless chat bubble that looks like the model spoke.
    return {
      action: "chat",
      reply: isDegenerate(reply) ? DEGENERATE_REPLY : reply,
    };
  }
  if (value.action === "code") {
    const filename = asString(value.filename, 180);
    const content = asString(value.content, 2_000_000);
    if (filename && content && !isDegenerate(content))
      return { action: "code", filename, content };
    return { action: "chat", reply: DEGENERATE_REPLY };
  }
  if (value.action === "essay") {
    const title = asString(value.title, 180);
    const content = asString(value.content, 200_000);
    const reply = cleanReply(value.reply).slice(0, 500);
    if (title && content && !isDegenerate(content))
      return { action: "essay", title, content, reply };
    // A rejected essay degrades to an honest chat note rather than saving
    // a looping or stub document.
    return { action: "chat", reply: DEGENERATE_REPLY };
  }
  if (value.action === "ppt") {
    const title = asString(value.title, 180);
    if (!title || !Array.isArray(value.slides) || value.slides.length > 40)
      return null;
    const slides = [];
    for (const slide of value.slides) {
      if (!slide || typeof slide !== "object") continue;
      const heading = asString(slide.heading, 120) || "Slide";
      const bullets = Array.isArray(slide.bullets)
        ? slide.bullets
            .filter((bullet) => typeof bullet === "string" && bullet.trim())
            .map((bullet) => bullet.trim().slice(0, 300))
            .slice(0, 8)
        : [];
      slides.push({ heading, bullets });
    }
    if (!slides.length) slides.push({ heading: title, bullets: [] });
    const reply = cleanReply(value.reply).slice(0, 500);
    return { action: "ppt", title, slides, reply };
  }
  return null;
}

// Edge models emit pretty-printed JSON with literal newlines inside string
// values — invalid JSON. Re-escape control characters inside strings so
// JSON.parse succeeds, mirroring the workbench brain's repair layer.
function repairJson(slice) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of slice) {
    const code = ch.charCodeAt(0);
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
      } else if (ch === "\\") {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        // other control chars are dropped, matching the workbench repair
      } else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function parseModelAction(text) {
  const raw = typeof text === "string" ? text : String(text ?? "");
  try {
    const slice = extractJsonObject(raw);
    if (!slice) throw new Error("No JSON object");
    let parsed;
    try {
      parsed = JSON.parse(slice);
    } catch {
      parsed = JSON.parse(repairJson(slice));
    }
    const normalized = normalizeAction(parsed);
    if (!normalized) throw new Error("Schema mismatch");
    return normalized;
  } catch {
    const reply = raw.trim();
    return {
      action: "chat",
      reply: reply || "The model returned an empty response.",
    };
  }
}

function healthUrlFor(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.hostname}:${url.port}/health`;
}

module.exports = {
  SYSTEM_PROMPT,
  DEFAULT_ENDPOINT,
  API_KEY,
  MODEL,
  validateEndpoint,
  resolveEndpoint,
  buildChatRequest,
  extractAssistantText,
  extractJsonObject,
  parseModelAction,
  healthUrlFor,
};
