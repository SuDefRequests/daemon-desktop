# DAEMON Desktop

Electron + React + TypeScript + Vite + Tailwind CSS + Lucide. A desktop integration foundation based on the supplied reference, with Android inference by default in desktop development and an explicit mock option.

```bash
cd /home/suraj_null/daemon-desktop
npm install
npm run dev           # browser at http://127.0.0.1:5173
```

Desktop development starts its own Vite server, selecting the next available port when 5173 is occupied. Electron receives that exact URL; no existing processes are terminated:

```bash
npm run electron:dev  # starts Vite, waits for readiness, launches Electron
```

For a compiled desktop launch:

```bash
npm run build
npm run electron:start
```

## Structure

- `src/App.tsx`: homepage, conversations, file library, device and settings views.
- `src/types.ts`: typed messages, conversations, artifacts, connection, model and desktop API.
- `src/inference.ts`: typed provider selection and restricted desktop adapter.
- `src/mock.ts`: retained, explicitly simulated inference provider.
- `src/preferences.ts`: session-only model and thinking demonstrations.
- `src/storage.ts`: Electron persistence and browser fallback.
- `electron/main.cjs`: validated IPC, local history, atomic writes, file saving and OS actions.
- `electron/preload.cjs`: narrow named methods; no raw IPC, filesystem or shell access.
- `electron/inference.cjs`: fixed-endpoint HTTP connector, validation, timeout and safe content conversion.
- `public/daemon-logo.svg`: replaceable logo independent of layout.

## Functionality and limits

History starts empty. Sending a prompt creates a conversation. Chats can be selected, searched, renamed and deleted with confirmation. Deleting a chat retains its artifacts. Mock generation creates actual Python, Markdown or CSV content, with previews and downloads. Presentation output is a Markdown outline, not a PPTX; document output is Markdown, not DOCX. All samples are fixed mock examples and do not claim to fulfill arbitrary prompts or run Qwen.

In Electron, history lives in the platform application data directory. Files default to `Documents/DAEMON`, or `DAEMON_SAVE_DIR` if set before launch. Choose another directory in Settings; prior files keep their paths. Open file and Show in folder use Electron shell APIs on registered artifacts only. System Open is disabled and rejected for `.py` files to prevent execution through file associations; Python source remains available through Preview and Show in folder. No artifact deletion action is exposed in the UI.

In browser preview, history and artifact contents persist in local storage for that origin. Download saves a copy through the browser. Directory selection and OS file actions are unavailable. Browser data and Electron data are separate. Storage failures and malformed saved history show errors; failed history loading prevents overwriting the original data.

Artifact names derive from the task brief, for example `hiking_planner.py`, `meeting_notes.md` and `monthly_budget.csv`. IDs stay in metadata. New disk files use those actual names, with `_2`, `_3` suffixes on collisions; exclusive creation preserves files created by DAEMON or other applications. Existing artifacts from the earlier UUID-prefixed storage format are preserved in place, displayed by their real disk filename, and remain available through file actions. Browser downloads use the library filename; the browser controls the final downloaded location and any download-folder collision handling.

Interaction motion uses CSS only: new-message appearances, menu entry/exit, view fades, artifact feedback, button states and success/error notices. Reduced motion suppresses movement and continuous loading animation. The mock provider retains its explicit one-second simulated generation delay; animations add no inference delay. File success feedback waits for workspace persistence, and generation indicators clear on success and failure.

The composer offers Qwen2.5 0.5B — Local and DAEMON Compact — Demo option. These selections and Low/Middle/Extended thinking modes are UI preferences for the current session. They change labels only, are not sent to Python, and do not change the provider or loaded model. A reload resets the preferences. No model detection, downloading or switching is implemented.

## Existing Python integration

`brain/daemon_brain_v4.py` is the phone-side Flask brain. Deploy this updated copy to Android and restart it; the legacy desktop Python UI is unchanged. The intended deployment runs the brain on Android port 5000 and llama-server on that same phone's localhost port 8080. Establish authorized USB ADB forwarding separately: `adb forward tcp:5000 tcp:5000`. Electron does not launch Python, ADB or arbitrary shell commands.

Provider selection is fixed for an Electron session by `DAEMON_PROVIDER=mock` or `DAEMON_PROVIDER=android`. Desktop development defaults to Android; compiled launches retain mock as their default. Unsupported values are rejected. Browser preview always uses mock mode. Restart Electron with mock mode when the phone is unavailable; real failures never silently substitute a mock response.

```bash
# Fedora: Android is the development default
npm run electron:dev
# Explicit mock development:
DAEMON_PROVIDER=mock npm run electron:dev
# Or, after a build:
DAEMON_PROVIDER=android npm run electron:start
```

```powershell
# Windows PowerShell:
npm run electron:dev  # Android by default
# To return to mock mode before the next launch:
$env:DAEMON_PROVIDER = "mock"
```

The boundary is React `InferenceProvider` → preload `generate(prompt)` → validated `inference:generate` IPC → main-process HTTP `POST http://127.0.0.1:5000/process` with only `{ "prompt": "..." }`. The renderer cannot supply a URL. Redirects are rejected. Prompt length is capped at 12,000 characters; the response body is capped at 2.1 MB and content at 2 million characters. The 600-second desktop timeout (longer than the brain’s 240-second llama-server request timeout) covers connection and body reading. HTTP errors, malformed JSON, missing fields, unsupported actions, empty content and `Error:` payloads are rejected. Only one real request per window is allowed at a time, and the lock/loading state clears on failures.

Phone status stays explicitly unverified in Android mode; neither provider configuration nor ADB forwarding proves a physical connection. The model name is an expected configuration, not detection. The brain receives individual prompts, not chat history or the UI's task preference.

The `chat` response uses `{ "action": "chat", "content": "...", "filename": "" }` and produces only an assistant message, never a file. Explicit creation requests retain artifact actions; ordinary questions default to chat, and the original prompt case reaches Qwen.

Returned `filename` is validated as a field but never used as a path or authoritative format. `automate_vscode` becomes `.py`; `automate_excel` must be consistent CSV and becomes `.csv`; `automate_notepad`, `automate_word` and `automate_ppt` become `.md` when Markdown markers are recognized, otherwise `.txt`. Text is never given Office extensions. CSV with inconsistent columns or unsupported Python fences produces a clear error. Canva produces an explanation and search phrase without creating a file or opening a browser. No generated Python is executed. Real Office document conversion is outside this foundation.

## Verification

Tests start their own isolated Vite servers; no separate dev server is required:

```bash
npm test                       # browser integration checks
TEST_ELECTRON=1 npm test        # desktop checks; needs a graphical session
python tests/brain.py           # dependency-free brain routing/schema checks
node tests/artifact-files.cjs   # filesystem collision/concurrent writer checks
npm run test:android           # Android mode with main-process HTTP fixtures; no phone request
```

`npm test` includes port-selection, connector and filesystem tests before the existing browser workflow checks. Electron tests use isolated temporary profiles/output directories. Coverage includes both providers, session-only model/thinking selections, prompt-only requests, all returned actions, JSON/HTTP/application/network errors, actual connection/body timeout aborts, bounded responses, loading cleanup, artifact preview/download, history after reload, rename, chat switching, deletion confirmation, retained files and restricted IPC. Screenshots go to `test-results/`.

Android-provider UI tests intercept HTTP in the main process. They exercise the real provider and IPC but do not establish physical phone inference. USB authorization, phone services/model loading and an actual end-to-end request still require the Android device.

Verified: production build, browser workflow checks and Electron workflow checks pass. Desktop tests verify all four files on disk and configurable output directories. Open-file and show-in-folder dispatch are verified with stubbed OS handlers, avoiding external application launches. The separate `electron:dev` command was also launched on Fedora, including occupied-port fallback and rejection of a duplicate development window. Automated tests use isolated Vite URLs. Windows startup and physical inference require manual verification.

Fedora desktop was used for development. Windows source support uses Electron's portable path/dialog/shell APIs; Windows has not yet been tested. This foundation has no installer/package workflow.

The preload and renderer follow Electron's [context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation); Tailwind uses the [Vite integration](https://tailwindcss.com/docs/installation/using-vite).
# daemon-desktop
