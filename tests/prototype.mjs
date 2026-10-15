import { createServer } from "vite";
import { verifySidebar } from "./sidebar.mjs";
import { verifyNewChatPreferences, expectWelcome } from "./new-chat.mjs";
import { chromium, _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
await mkdir("test-results", { recursive: true });
const mode = process.env.TEST_ELECTRON === "1";
const temp = await mkdtemp(path.join(os.tmpdir(), "daemon-test-"));
let desktop, browser, page;
const devServer = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await devServer.listen();
const devURL = devServer.resolvedUrls.local[0];
try {
  if (mode) {
    desktop = await electron.launch({
      args: [".", `--user-data-dir=${temp}/profile`],
      env: {
        ...process.env,
        DAEMON_DEV: "1",
        DAEMON_DEV_URL: devURL,
        DAEMON_PROVIDER: "mock",
        DAEMON_SAVE_DIR: `${temp}/output`,
      },
    });
    page = await desktop.firstWindow();
  } else {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({
      viewport: { width: 1440, height: 940 },
      acceptDownloads: true,
    });
    await page.goto(devURL);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "VIDUR AI", exact: true }).waitFor();
  assert.equal(await page.locator("header .model-button").count(), 0);
  assert.equal(await page.locator(".composer .model-button").count(), 1);
  await verifySidebar(page, !mode);
  await page.locator(".model-button").click();
  assert.equal(await page.locator(".model-menu > button").count(), 2);
  await page.getByRole("button", { name: /VIDUR AI Compact/ }).click();
  assert.match(
    await page.locator(".model-button").innerText(),
    /VIDUR AI Compact/,
  );
  await page
    .getByRole("button", { name: "Thinking mode", exact: true })
    .click();
  await page
    .locator(".thinking-menu")
    .getByRole("button", { name: "Extended", exact: true })
    .click();
  assert.match(await page.locator(".thinking-button").innerText(), /Extended/);
  const providerCheck = await page.evaluate(async () => {
    const { createProvider, configuredProvider } =
      await import("/src/inference.ts");
    const calls = [];
    const desktop = {
      getInferenceConfig: async () => ({ provider: "android" }),
      generate: async (...args) => {
        calls.push(args);
        return {
          reply: "result",
          file: { kind: "document", extension: ".txt", content: "Plain text" },
        };
      },
    };
    const real = await configuredProvider(desktop);
    const result = await real.generate({
      prompt: "Meeting notes",
      task: "presentation",
      modelId: "daemon-compact",
      thinkingMode: "Extended",
    });
    const chat = await createProvider("android", {
      generate: async () => ({ reply: "Hello!" }),
    }).generate({ prompt: "Hello", task: "chat" });
    if (Object.hasOwn(chat, "file"))
      throw new Error("Chat must not include a file property");
    let unavailable;
    try {
      await createProvider("android").generate({
        prompt: "Hello",
        task: "chat",
      });
    } catch (e) {
      unavailable = e.message;
    }
    return {
      calls,
      result,
      mode: real.mode,
      mock: createProvider("mock").mode,
      browser: (await configuredProvider()).mode,
      unavailable,
    };
  });
  assert.equal(providerCheck.mode, "android");
  assert.equal(providerCheck.mock, "mock");
  assert.equal(providerCheck.browser, "mock");
  assert.deepEqual(providerCheck.calls, [["Meeting notes"]]);
  assert.equal(providerCheck.result.file.name, "meeting_notes.txt");
  // Only browser preview lacks a desktop API. Electron uses its supplied API.
  if (!mode) assert.match(providerCheck.unavailable, /requires Electron/);
  if (mode) {
    assert.equal(
      (await page.evaluate(() => window.daemon.getInferenceConfig())).provider,
      "mock",
    );
    await assert.rejects(
      page.evaluate(() => window.daemon.generate("hello")),
      /disabled in mock mode/,
    );
    await assert.rejects(
      page.evaluate(() =>
        window.daemon.generate({ url: "https://example.com" }),
      ),
      /Prompt must/,
    );
  }
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: `test-results/${mode ? "electron" : "browser"}-home.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Write code/ }).click();
  await page
    .getByRole("textbox", { name: "Your prompt" })
    .fill("Write Python code to calculate a total");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await page.getByText("Preparing a mock response…").waitFor();
  await page.getByText("calculate_a_total.py", { exact: true }).waitFor();
  assert.match(
    await page.locator(".model-button").innerText(),
    /VIDUR AI Compact/,
  );
  assert.match(await page.locator(".thinking-button").innerText(), /Extended/);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.locator("pre").innerText(), /calculate_total/);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", {
      name: "Actions for Write Python code to calculate a total",
    })
    .click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Conversation name" })
    .fill("Calculation example");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Calculation example", exact: true })
    .waitFor();
  await verifyNewChatPreferences(page);
  await page
    .getByRole("button", { name: "Calculation example", exact: true })
    .click();
  await page.getByText("calculate_a_total.py", { exact: true }).waitFor();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Your prompt" })
    .fill("Hello from a second conversation");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await page
    .getByText("This is a mock response to", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Search conversations", exact: true })
    .click();
  await page.waitForFunction(
    () => document.activeElement?.id === "conversation-search",
  );
  await page
    .getByRole("textbox", { name: "Search conversations" })
    .fill("Calculation example");
  assert.equal(await page.locator(".chat-select").count(), 1);
  await page.getByRole("textbox", { name: "Search conversations" }).fill("");
  assert.equal(await page.locator(".chat-select").count(), 2);
  await page
    .getByRole("button", { name: "Calculation example", exact: true })
    .click();
  await page.getByText("calculate_a_total.py", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Actions for Calculation example" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Calculation example", exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "Actions for Calculation example" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByRole("button", { name: "My files", exact: true }).click();
  await page
    .getByRole("heading", { name: "calculate_a_total.py", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Calculation example", exact: true })
      .count(),
    0,
  );
  if (!mode) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "calculate_a_total.py");
  }
  if (mode) {
    const d = await page.evaluate(() => window.daemon.load());
    assert.equal(d.artifacts.length, 1);
    assert.match(
      await readFile(d.artifacts[0].path, "utf8"),
      /calculate_total/,
    );
    assert.ok(d.artifacts[0].path.startsWith(`${temp}/output`));
    assert.equal(await page.evaluate(() => window.require), undefined);
    await assert.rejects(
      page.evaluate(() => window.daemon.openArtifact("../../etc/passwd")),
    );
    await assert.rejects(
      page.evaluate(() =>
        window.daemon.saveArtifact({
          id: "bad",
          name: "../bad.py",
          content: "bad",
        }),
      ),
    );
  }
  await page.reload();
  await page.getByRole("button", { name: "My files", exact: true }).click();
  await page
    .getByRole("heading", { name: "calculate_a_total.py", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Choose output directory" })
      .isEnabled(),
    mode,
  );
  if (mode) {
    await mkdir(`${temp}/chosen`, { recursive: true });
    await desktop.evaluate(({ dialog, shell }, chosen) => {
      globalThis.daemonTestActions = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [chosen],
      });
      shell.openPath = async (p) => {
        globalThis.daemonTestActions.push(["open", p]);
        return "";
      };
      shell.showItemInFolder = (p) =>
        globalThis.daemonTestActions.push(["reveal", p]);
    }, `${temp}/chosen`);
    await page.getByRole("button", { name: "Choose output directory" }).click();
    await page.getByText(`${temp}/chosen`, { exact: true }).waitFor();
    await page.getByRole("button", { name: "My files", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Open file", exact: true })
        .isEnabled(),
      false,
    );
    await assert.rejects(
      page.evaluate(async () =>
        window.daemon.openArtifact(
          (await window.daemon.load()).artifacts[0].id,
        ),
      ),
      /could execute code/,
    );
    await page
      .getByRole("button", { name: "Show in folder", exact: true })
      .click();
    const calls = await desktop.evaluate(() => globalThis.daemonTestActions);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "reveal");
  }
  for (const [card, filename, taskPrompt] of [
    [
      "Draft a document",
      "meeting_notes.md",
      "Draft a document about meeting notes",
    ],
    [
      "Make a presentation",
      "project_overview.md",
      "Create a presentation about project overview",
    ],
    [
      "Create a spreadsheet",
      "monthly_budget.csv",
      "Create a spreadsheet for monthly budget",
    ],
  ]) {
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(card) }).click();
    await page.getByRole("textbox", { name: "Your prompt" }).fill(taskPrompt);
    await page.getByRole("button", { name: "Send prompt" }).click();
    await page.getByText(filename, { exact: true }).waitFor();
  }
  if (mode) {
    const saved = await page.evaluate(() => window.daemon.load());
    assert.equal(saved.artifacts.length, 4);
    for (const a of saved.artifacts) {
      assert.equal(await readFile(a.path, "utf8"), a.content);
      assert.equal(path.basename(a.path), a.name);
      if (a.name !== "calculate_a_total.py")
        assert.ok(a.path.startsWith(`${temp}/chosen`));
    }
    const document = saved.artifacts.find((a) => a.name === "meeting_notes.md");
    await page.evaluate((id) => window.daemon.openArtifact(id), document.id);
    const openCalls = await desktop.evaluate(
      () => globalThis.daemonTestActions,
    );
    assert.deepEqual(openCalls.at(-1), ["open", document.path]);
  }
  // Return to the original directory before testing its existing filename.
  if (mode) {
    await desktop.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [chosen],
      });
    }, `${temp}/output`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Choose output directory" }).click();
    await page.getByText(`${temp}/output`, { exact: true }).waitFor();
  }
  // Repeating the same task allocates a readable suffix; the original stays intact.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /Write code/ }).click();
  await page
    .getByRole("textbox", { name: "Your prompt" })
    .fill("Write Python code to calculate a total");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await page.getByText("calculate_a_total_2.py", { exact: true }).waitFor();
  assert.equal(await page.locator(".loading").count(), 0);
  assert.equal(
    await page.getByRole("textbox", { name: "Your prompt" }).isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  assert.match(await page.locator("pre").innerText(), /calculate_total/);
  await page.getByRole("button", { name: "Close dialog" }).click();
  if (mode) {
    const artifacts = (await page.evaluate(() => window.daemon.load()))
      .artifacts;
    const first = artifacts.find((a) => a.name === "calculate_a_total.py");
    const second = artifacts.find((a) => a.name === "calculate_a_total_2.py");
    assert.equal(path.basename(first.path), first.name);
    assert.equal(path.basename(second.path), second.name);
    assert.equal(await readFile(first.path, "utf8"), first.content);
    assert.equal(await readFile(second.path, "utf8"), second.content);
    assert.equal(
      await page
        .getByRole("button", { name: "Open file", exact: true })
        .isEnabled(),
      false,
    );
    await page
      .getByRole("button", { name: "Show in folder", exact: true })
      .click();
    const calls = await desktop.evaluate(() => globalThis.daemonTestActions);
    assert.equal(calls.at(-1)[1], second.path);
  } else {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    assert.equal(
      (await downloadPromise).suggestedFilename(),
      "calculate_a_total_2.py",
    );
  }
  const names = await page.evaluate(async () => {
    const { artifactFilename } = await import("/src/filenames.ts");
    return [
      artifactFilename("Write Python code for hiking planner", "code"),
      artifactFilename("Draft a document about meeting notes", "document"),
      artifactFilename(
        "Create a spreadsheet for monthly budget",
        "spreadsheet",
      ),
      artifactFilename("../CON", "code"),
      artifactFilename("!!!", "document"),
      artifactFilename("Café / meeting: notes?", "document"),
    ];
  });
  assert.deepEqual(names, [
    "hiking_planner.py",
    "meeting_notes.md",
    "monthly_budget.csv",
    "daemon_con.py",
    "document.md",
    "cafe_meeting_notes.md",
  ]);
  // CSS completion drives exits, including reduced motion; closing controls are inert.
  await page.locator(".model-button").click();
  await page.locator(".model-menu.entering").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".model-menu"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".model-button").click();
  await page.locator(".model-menu").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".model-menu"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Force a real save failure rather than adding a fake inference error path.
  if (mode) {
    await desktop.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [chosen],
      });
    }, `${temp}/output/calculate_a_total_2.py`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Choose output directory" }).click();
  } else {
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new Error("Storage quota test failure");
      };
    });
  }
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .locator(".productivity-card")
    .filter({ hasText: "Draft a document" })
    .click();
  await page
    .getByRole("textbox", { name: "Your prompt" })
    .fill("Draft a document about failure test");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".loading") &&
      !document.querySelector("textarea").disabled,
  );
  assert.match(
    await page.getByRole("alert").innerText(),
    mode ? /Request failed/ : /Could not save history/,
  );
  assert.equal(await page.locator(".toast.success").count(), 0);
  if (!mode) await page.reload();
  await page
    .getByRole("button", { name: "Device & model", exact: true })
    .click();
  await page.getByRole("heading", { name: "Mock mode" }).waitFor();
  if (!mode) {
    await page.setViewportSize({ width: 900, height: 720 });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "test-results/browser-compact.png",
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  if (!mode) {
    await page.evaluate(() =>
      localStorage.setItem(
        "daemon-workspace-v1",
        JSON.stringify({
          conversations: [
            { id: "broken", title: "Broken history", messages: null },
          ],
          artifacts: [],
        }),
      ),
    );
    await page.reload();
    await page.getByRole("alert").waitFor();
    assert.match(
      await page.getByRole("alert").innerText(),
      /Could not load history/,
    );
    assert.equal(
      await page.getByRole("textbox", { name: "Your prompt" }).isEnabled(),
      false,
    );
    assert.match(
      await page.evaluate(() => localStorage.getItem("daemon-workspace-v1")),
      /Broken history/,
    );
    await page.evaluate(() => localStorage.removeItem("daemon-workspace-v1"));
  }
  if (mode) {
    const savedSettings = JSON.parse(
      await readFile(path.join(temp, "profile", "settings.json"), "utf8"),
    );
    assert.equal(
      savedSettings.preferredName,
      "Mira",
      "Output directory changes preserve the name",
    );
    assert.equal(typeof savedSettings.outputDirectory, "string");
    await desktop.close();
    desktop = await electron.launch({
      args: [".", `--user-data-dir=${temp}/profile`],
      env: {
        ...process.env,
        DAEMON_DEV: "1",
        DAEMON_DEV_URL: devURL,
        DAEMON_PROVIDER: "mock",
        DAEMON_SAVE_DIR: `${temp}/output`,
      },
    });
    page = await desktop.firstWindow();
    await page
      .getByRole("heading", { name: "VIDUR AI", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expectWelcome(page, "Mira");
  }
  console.log(
    `${mode ? "Electron" : "Browser"}: persistence, chat switching, rename, delete confirmation, retained artifacts, previews, file actions, model selector and disconnected states passed.`,
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({
        path: `test-results/${mode ? "electron" : "browser"}-failure.png`,
      })
      .catch(() => {});
    console.error(
      await page
        .evaluate(() => ({
          menu: document.querySelector(".model-menu")?.outerHTML,
          animation:
            document.querySelector(".model-menu") &&
            getComputedStyle(document.querySelector(".model-menu")).animation,
          loading: !!document.querySelector(".loading"),
          feedback: document.querySelector(".toast")?.textContent,
        }))
        .catch(() => {}),
    );
  }
  throw error;
} finally {
  await devServer.close();
  await desktop?.close();
  await browser?.close();
}
