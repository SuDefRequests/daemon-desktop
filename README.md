VIDUR AI
A local-first AI desktop application powered by your own device.
VIDUR AI is an Electron + React + TypeScript desktop app that connects to a locally hosted AI brain on an Android device. It brings chat, code generation, and document creation into one desktop workspace—without silently switching to mock responses when the real provider is unavailable.
Download VIDUR AI for Windows · Releases · Report an issue
Latest release: VIDUR AI v0.1.0
Windows installer: VIDUR.AI.Setup.0.1.0.exe

Features
Local AI workflow
- Connects to the VIDUR brain service running on your Android device.
- Uses ADB to discover devices and forward the brain service to the desktop.
- Reports useful connection states, including missing ADB, no device, authorization issues, forwarding errors, and unavailable brain services.
- Uses Android mode by default in Electron builds.
- Offers an explicit mock provider for development and UI testing; real-provider failures do not silently fall back to mock answers.
Chat and workspace
- Conversation history with chat selection, search, rename, and deletion confirmation.
- File library for generated artifacts, with previews and file actions.
- Persistent history and generated files in the desktop app.
- Browser preview mode for UI development; browser storage is separate from Electron storage.
Code and file generation
- Generates source-code files and can open them in VS Code.
- Creates genuine .docx Word documents and .pptx PowerPoint presentations from model-provided content.
- Supports Markdown/text and CSV artifacts.
- Uses readable task-based filenames and avoids overwriting existing files by adding collision suffixes.
- Includes preview, open, and show-in-folder actions where supported by the platform.
Desktop integration and safeguards
- Electron context isolation with a narrow preload API.
- Validated IPC and a fixed local inference endpoint; the renderer cannot choose an arbitrary request URL.
- Bounded request/response handling and timeouts.
- Generated source code is saved as a file, not executed by VIDUR.
- Reduced-motion support for interface animations.
Download and install
Windows
1. Open the VIDUR AI v0.1.0 release page.
2. Download VIDUR.AI.Setup.0.1.0.exe from Assets.
3. Run the installer and follow the prompts.
Requirements for Android-backed inference
- Windows 10/11, 64-bit.
- Android Platform Tools (ADB) installed and discoverable by VIDUR.
- An authorized Android device connected over USB or otherwise available to ADB.
- The VIDUR brain service and a compatible local model server running on the phone.
If no Android device is connected, VIDUR should report the appropriate ADB/device status. It does not mean the app is using a real model until the Android service is connected and requests succeed.
Early-release note: Windows may show a security warning because this build may not have a trusted publisher signature. Only install software you trust, and download VIDUR from this repository's official release page.

How it works
At a high level, the desktop app sends a prompt through the Electron preload/IPC boundary to the main process, which makes a request to the local forwarded brain endpoint:
VIDUR UI
   │
   ▼
Inference provider
   │
   ▼
Electron preload → validated IPC → Electron main process
   │
   ▼
http://127.0.0.1:5000/process
   │
   ▼
ADB port forwarding
   │
   ▼
VIDUR brain on Android → local model server
The desktop sends the individual prompt to the brain service; the UI's conversation history and model/thinking preference labels are not automatically sent as model context. The health endpoint checks the brain service, not whether the model is loaded or capable of completing inference.
Provider behavior
- Electron: Android is the default provider.
- Mock mode: explicitly selected for development/testing.
- Browser preview: uses mock mode because browser preview cannot perform the desktop's ADB and operating-system actions.
- No silent fallback: when Android inference fails, VIDUR reports the failure instead of presenting a mock response as real inference.
Android brain setup
The repository includes brain/daemon_brain_v4.py, a Flask service intended to run on the Android device. The expected setup is:
- Brain service on Android port 5000.
- Local model server on the phone's localhost port 8080.
- ADB forwarding from desktop port 5000 to device port 5000.
VIDUR looks for ADB through DAEMON_ADB_PATH, ANDROID_HOME, ANDROID_SDK_ROOT, the standard SDK location, or PATH. With multiple authorized devices, set ANDROID_SERIAL to select the intended device. VIDUR does not guess between multiple devices.
The brain exposes GET /health for a lightweight service health check. A healthy response confirms that the Flask service is responding; it does not confirm model loading or successful generation.
Check ADB on Windows
Open PowerShell and run:
adb devices -l
If adb is not recognized, install Android Platform Tools or add its directory to PATH. You can also point VIDUR directly to the executable before launching it:
$env:DAEMON_ADB_PATH = (Get-Command adb.exe -ErrorAction Stop).Source
If the phone appears as unauthorized, unlock it and accept the USB debugging authorization prompt on the phone.
Update the brain script
From the repository directory, with one authorized device connected:
adb push .\brain\daemon_brain_v4.py /sdcard/Download/daemon_brain_v4.py
Stop the currently running Flask brain process on the phone (leave the model server running), then start the updated script in the phone's Python environment:
python /sdcard/Download/daemon_brain_v4.py
If using Termux, grant shared-storage access with termux-setup-storage if needed. Do not run two brain services on port 5000.
Development
Requirements
- Node.js and npm.
- Git.
- For Android integration tests or real inference: Android Platform Tools and an authorized Android device.
- Python for the brain checks and the Android-side Flask service.
Install dependencies
git clone https://github.com/SuDefRequests/daemon-desktop.git
cd daemon-desktop
npm ci
Run the app
Run the web UI in a browser:
npm run dev
Run the Electron desktop app (Android provider by default):
npm run electron:dev
Run Electron with the explicit mock provider:
# Linux/macOS
DAEMON_PROVIDER=mock npm run electron:dev
# Windows PowerShell
$env:DAEMON_PROVIDER = "mock"
npm run electron:dev
Build the production frontend:
npm run build
Launch the compiled Electron app:
npm run electron:start
Windows installer build
npm ci
npm run dist
The installer is written to release/. For packaging troubleshooting, see [`docs/windows-packaging.md`](docs/windows-packaging.md).
Tests
Run the main test suite:
npm test
Android provider tests use fixtures and mocked HTTP responses; they do not require a physical phone request:
npm run test:android
Brain routing/schema checks:
# Linux/macOS
python3 tests/brain.py
# Windows
py -3 tests/brain.py
If the browser integration tests report that Playwright Chromium is missing, install it:
npx playwright install chromium
Important: Passing automated tests does not establish that physical Android inference works. End-to-end validation still requires an authorized phone, ADB forwarding, the updated brain service, and the local model server.
Configuration
Variable	Purpose
DAEMON_PROVIDER=android	Select the Android provider explicitly.
DAEMON_PROVIDER=mock	Select mock mode explicitly for development/testing.
DAEMON_ADB_PATH	Absolute path to adb/adb.exe when it is not discoverable automatically.
ANDROID_HOME	Android SDK directory.
ANDROID_SDK_ROOT	Alternative Android SDK directory.
ANDROID_SERIAL	Select a specific authorized device when multiple devices are connected.
DAEMON_SAVE_DIR	Override the default artifact output directory before launching Electron.
DAEMON_VSCODE_PATH	Absolute path to the VS Code launcher for a custom installation.


Provider selection is fixed for an Electron session. Restart the app after changing provider environment variables.
Current limitations
- The model/thinking selectors are session-level UI preferences; they do not download, detect, or switch models.
- Chat history is not automatically sent to the brain as conversational context; requests contain the individual prompt.
- The health check verifies the brain service, not model availability or inference quality.
- Spreadsheet artifacts are CSV; XLSX and PDF generation are not implemented.
- Canva requests return an explanation/search phrase rather than generating a Canva project.
- Browser preview does not provide ADB integration, native file opening, or desktop directory selection.
- The Windows release is an early build; Windows Smart App Control or other security features may display warnings if the executable lacks a trusted publisher signature.
Project structure
daemon-desktop/
├── src/                    # React UI, inference provider, storage and types
├── electron/
│   ├── main.cjs             # Main process, IPC, persistence and OS actions
│   ├── preload.cjs          # Restricted renderer bridge
│   └── inference.cjs        # Validated local inference connector
├── brain/
│   └── daemon_brain_v4.py   # Android-side Flask brain
├── tests/                   # Packaging, provider, artifact and workflow tests
├── docs/
│   └── windows-packaging.md # Windows packaging and diagnostics
└── package.json
Security notes
- The renderer does not receive raw IPC, filesystem, or shell access.
- The inference endpoint is fixed in the Electron main process; redirects are rejected.
- Request and response sizes are bounded, and errors/timeouts are surfaced.
- Generated code is not executed by VIDUR.
- Keep Android USB debugging enabled only when you need it, and authorize only devices you trust.
Contributing and issues
Bug reports, feature requests, and contributions are welcome. Please include your operating system, VIDUR version, steps to reproduce, and relevant logs—do not include private prompts, credentials, or other sensitive information.
- Open an issue
- Browse releases
VIDUR AI — local-first AI, connected to your own device.