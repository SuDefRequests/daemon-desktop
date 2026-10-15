import os
import time
import re
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

LLAMA_SERVER_URL = "http://127.0.0.1:8080/completion"

# ---------------------------------------------------------------------------
# These are SAFETY CEILINGS, not per-task targets. The model stops on its
# own (via the stop sequences below) as soon as it naturally finishes --
# these numbers only exist so a rare failure-to-stop can't hang forever
# during a live demo. At ~3.9 tok/s: seconds ~= tokens / 3.9.
#   ppt:     700 tokens ~= 179s (~3 min)  -- matches "2-3 min is fine for PPT"
#   word:    500 tokens ~= 128s
#   vscode:  400 tokens ~= 103s
#   excel:   300 tokens ~= 77s
#   notepad: 300 tokens ~= 77s
#   canva:    15 tokens ~= 4s  (just a search query, genuinely short)
# If a real task ever hits its ceiling, raise that one number -- don't
# remove the ceiling entirely (see REQUEST_TIMEOUT note below too).
# ---------------------------------------------------------------------------
TOKEN_CEILING = {
    "word": 500,
    "excel": 300,
    "ppt": 700,
    "vscode": 600,   # raised -- code burns more tokens per line than prose
    "notepad": 300,
    "canva": 15,
}

# Must exceed the slowest ceiling's generation time with real margin.
# max(TOKEN_CEILING.values())=700 -> ~179s -> 240s gives ~60s of headroom
# for model-load/prompt-eval variance. Raise this if you raise a ceiling.
REQUEST_TIMEOUT = 240


def generate_text(prompt, max_tokens):
    qwen_prompt = f"<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n"
    start = time.perf_counter()
    print(f"[DAEMON] Sending to llama-server, ceiling={max_tokens} tokens ...", flush=True)

    try:
        r = requests.post(
            LLAMA_SERVER_URL,
            json={
                "prompt": qwen_prompt,
                "n_predict": int(max_tokens),
                "temperature": 0.2,
                "stop": ["<|im_end|>", "<|im_start|>"],
            },
            timeout=REQUEST_TIMEOUT,
        )
        elapsed = time.perf_counter() - start
        print(f"[DAEMON] llama-server responded in {elapsed:.1f}s", flush=True)

        data = r.json()
        output = data.get("content", "").strip()
        return output if output else "Error: Blank output from Qwen."

    except requests.exceptions.Timeout:
        elapsed = time.perf_counter() - start
        print(f"[DAEMON] llama-server did not respond within {REQUEST_TIMEOUT}s "
              f"(elapsed {elapsed:.1f}s)", flush=True)
        return "Error: AI timed out."
    except requests.exceptions.ConnectionError:
        print("[DAEMON] Could not reach llama-server on port 8080 -- is it running?", flush=True)
        return "Error: llama-server not running."
    except Exception as e:
        print(f"[DAEMON] Exception: {e}", flush=True)
        return f"Error: {e}"


def get_intent(text):
    text = text.lower()
    if any(w in text for w in ["code", "python", "script", "vs"]): return "vscode"
    if any(w in text for w in ["excel", "sheet", "table", "csv"]): return "excel"
    if any(w in text for w in ["canva", "poster", "design"]): return "canva"
    if any(w in text for w in ["ppt", "powerpoint", "slide", "presentation"]): return "ppt"
    if any(w in text for w in ["notepad", "note", "txt"]): return "notepad"
    return "word"


@app.route('/process', methods=['POST'])
def process_command():
    req_start = time.perf_counter()
    user_prompt = request.json.get("prompt", "").lower()
    print(f"[DAEMON] Incoming request: {user_prompt!r}", flush=True)

    intent = get_intent(user_prompt)
    ceiling = TOKEN_CEILING[intent]

    words = re.sub(r'[^a-zA-Z0-9 ]', '', user_prompt).split()
    raw_name = "_".join(words[-3:]) if len(words) >= 3 else "output"
    context_name = f"DAEMON_{raw_name}"

    if intent == "vscode":
        output = generate_text(
            f"Write simple python code for: {user_prompt}. "
            f"ONLY output raw code, no comments, no explanation, no markdown.", ceiling)
        output = output.replace("```python", "").replace("```", "").strip()
        resp = jsonify({"action": "automate_vscode", "content": output, "filename": f"{context_name}.py"})

    elif intent == "excel":
        output = generate_text(f"Generate rows of CSV data for: {user_prompt}. No headers.", ceiling)
        resp = jsonify({"action": "automate_excel", "content": output, "filename": f"{context_name}.xlsx"})

    elif intent == "canva":
        output = generate_text(f"Extract a 2 word design search query from: {user_prompt}.", ceiling)
        resp = jsonify({"action": "automate_canva", "content": output, "filename": ""})

    elif intent == "ppt":
        # No formatting instructions -- a 0.5B model can't reliably follow
        # multi-slide structure. Plain sentences; slide-splitting happens
        # deterministically in Daemon_UI.py instead of trusting the model.
        output = generate_text(f"Write a short presentation script about: {user_prompt}.", ceiling)
        resp = jsonify({"action": "automate_ppt", "content": output, "filename": f"{context_name}.pptx"})

    elif intent == "notepad":
        output = generate_text(f"Write plain text notes for: {user_prompt}.", ceiling)
        resp = jsonify({"action": "automate_notepad", "content": output, "filename": f"{context_name}.txt"})

    else:
        output = generate_text(f"Write a short essay for: {user_prompt}", ceiling)
        resp = jsonify({"action": "automate_word", "content": output, "filename": f"{context_name}.docx"})

    print(f"[DAEMON] Total request time: {time.perf_counter() - req_start:.1f}s", flush=True)
    return resp


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)
