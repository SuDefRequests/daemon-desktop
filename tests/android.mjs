import { createServer } from "vite";
import { expectWelcome } from "./new-chat.mjs";
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp = await mkdtemp(path.join(os.tmpdir(), "daemon-android-fixtures-"));
let app, page;
const devServer = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await devServer.listen();
const devURL = devServer.resolvedUrls.local[0];
try {
  app = await electron.launch({
    args: [".", `--user-data-dir=${temp}/profile`],
    env: {
      ...process.env,
      DAEMON_DEV: "1",
      DAEMON_DEV_URL: devURL,

      DAEMON_SAVE_DIR: `${temp}/output`,
    },
  });
  page = await app.firstWindow();
  await page.getByRole("heading", { name: "VIDUR AI", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector("textarea").disabled,
  );
  assert.equal(
    (await page.evaluate(() => window.daemon.getInferenceConfig())).provider,
    "android",
  );
  assert.match(
    await page.locator(".connection-pill").innerText(),
    /Connected|Connection|Device|ADB|Authorization|Forwarding|Brain|Select/,
  );
  await app.evaluate(() => {
    globalThis.daemonRequests = [];
    globalThis.daemonFixture = {};
    // Intercept in main: no request is made to a phone or a local service.
    globalThis.fetch = async (url, options) => {
      if (url.endsWith("/health"))
        return new Response(
          JSON.stringify({ service: "vidur-brain", status: "ok" }),
          { headers: { "content-type": "application/json" } },
        );
      globalThis.daemonRequests.push({
        url,
        body: JSON.parse(options.body),
        redirect: options.redirect,
      });
      // Deterministic pending request: the test releases it after observing loading.
      await new Promise((resolve) => {
        globalThis.daemonRelease = resolve;
      });
      const fixture = globalThis.daemonFixture;
      if (fixture.error) {
        const error = new Error("fixture failure");
        error.name = fixture.error;
        throw error;
      }
      return new Response(fixture.raw ?? JSON.stringify(fixture.data), {
        status: fixture.status ?? 200,
        headers: { "content-type": fixture.type ?? "application/json" },
      });
    };
  });
  // Push the same main-process snapshot consumed by all three status surfaces.
  async function assertStatus(state, label, detail) {
    await app.evaluate(
      ({ BrowserWindow }, snapshot) => {
        BrowserWindow.getAllWindows()[0].webContents.send(
          "device:status",
          snapshot,
        );
      },
      { state, label, detail },
    );
    await page.waitForFunction(
      (label) =>
        [".connection-pill", ".sidebar-status", ".home-footnote"].every(
          (selector) =>
            document.querySelector(selector)?.textContent.includes(label),
        ),
      label,
    );
    assert.equal(
      await page.getByText("Demo settings · UI only", { exact: true }).count(),
      0,
    );
  }
  for (const [state, label] of [
    ["disconnected", "Device not connected"],
    ["unauthorized", "Authorization required"],
    ["brain-unavailable", "Brain service unavailable"],
    ["connected", "Connected"],
  ])
    await assertStatus(state, label, "Fixture device status");
  await page.locator(".model-button").click();
  await page.getByRole("button", { name: /VIDUR AI Compact/ }).click();
  await page
    .getByRole("button", { name: "Thinking mode", exact: true })
    .click();
  await page
    .locator(".thinking-menu")
    .getByRole("button", { name: "Middle", exact: true })
    .click();
  async function submit(fixture, prompt) {
    await app.evaluate((_electron, fixture) => {
      globalThis.daemonFixture = fixture;
    }, fixture);
    const beforeRequests = await app.evaluate(
      () => globalThis.daemonRequests.length,
    );
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expectWelcome(page);
    assert.equal(
      await app.evaluate(() => globalThis.daemonRequests.length),
      beforeRequests,
    );
    assert.equal(await page.locator(".message, .productivity-card").count(), 0);
    assert.match(
      await page.locator(".model-button").innerText(),
      /VIDUR AI Compact/,
    );
    assert.match(await page.locator(".thinking-button").innerText(), /Middle/);
    await page.getByRole("textbox", { name: "Your prompt" }).fill(prompt);
    await page.getByRole("button", { name: "Send prompt" }).click();
    await page.locator(".loading[role='status']").waitFor();
    await assert.rejects(
      page.evaluate(() => window.daemon.generate("Concurrent request")),
      /already in progress/,
    );
    // Release on the next main-loop turn, after the debugger evaluation returns.
    await app.evaluate(() => {
      setTimeout(() => globalThis.daemonRelease(), 0);
      return true;
    });
    await page.waitForFunction(
      () =>
        !document.querySelector(".loading") &&
        !document.querySelector("textarea").disabled,
    );
    const requests = await app.evaluate(() => globalThis.daemonRequests);
    assert.equal(requests.at(-1).url, "http://127.0.0.1:5000/process");
    assert.deepEqual(requests.at(-1).body, { prompt });
    assert.equal(requests.at(-1).redirect, "error");
  }
  await submit(
    { data: { action: "chat", content: "Hello, Suraj!", filename: "" } },
    "Hello!",
  );
  assert.equal(
    (await page.evaluate(() => window.daemon.load())).artifacts.length,
    0,
  );
  assert.match(
    await page.locator(".message.assistant").innerText(),
    /Hello, Suraj!/,
  );
  const fixtures = [
    [
      "automate_vscode",
      'print("Hello")',
      "Write Python code for hiking planner",
      "hiking_planner.py",
    ],
    [
      "automate_notepad",
      "Meeting notes",
      "Write notes about meeting notes",
      "meeting_notes.txt",
    ],
    [
      "automate_excel",
      "Item,Price\nNotebook,5",
      "Create a spreadsheet for monthly budget",
      "monthly_budget.csv",
    ],
    [
      "automate_word",
      "# Report\n\n- Findings",
      "Draft a document about project report",
      "project_report.md",
    ],
    [
      "automate_ppt",
      "Introduction. Main points. Conclusion.",
      "Create a presentation about project overview",
      "project_overview.txt",
    ],
  ];
  for (const [action, content, prompt, name] of fixtures) {
    await submit(
      {
        data: {
          action,
          content,
          filename:
            action === "automate_vscode"
              ? "../../misleading.py"
              : "../../misleading.docx",
        },
      },
      prompt,
    );
    await page.getByText(name, { exact: true }).waitFor();
    const workspace = await page.evaluate(() => window.daemon.load());
    const artifact = workspace.artifacts.find((a) => a.name === name);
    assert.equal(artifact.source, "android");
    assert.equal(path.basename(artifact.path), name);
    assert.equal(await readFile(artifact.path, "utf8"), content);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    assert.equal(await page.locator("pre").innerText(), content);
    await page.getByRole("button", { name: "Close dialog" }).click();
  }
  await app.evaluate(({ shell }) => {
    globalThis.languageReveals = [];
    shell.showItemInFolder = (path) => {
      globalThis.languageReveals.push(path);
    };
  });
  const languageCases = [
    ["python", ".py", 'print("Language sample")'],
    ["javascript", ".js", "const sample = `literal ``` text`;\n"],
    ["typescript", ".ts", "const sample: number = 1;"],
    ["c", ".c", "int main(void) { return 0; }"],
    ["cpp", ".cpp", "int main() { return 0; }"],
    ["java", ".java", "public class Student { public Student() {} }"],
    ["html", ".html", "<h1>Language sample</h1>"],
    ["css", ".css", "body { color: red; }"],
    ["rust", ".rs", "fn main() {}"],
    ["go", ".go", "package main\nfunc main() {}"],
    ["shell", ".sh", '#!/bin/sh\necho "Language sample"'],
  ];
  for (const [language, extension, content] of languageCases) {
    const ids = await page.evaluate(async () =>
      (await window.daemon.load()).artifacts.map((a) => a.id),
    );
    await submit(
      {
        data: {
          action: "automate_vscode",
          language,
          filename: "../../unsafe" + extension,
          content,
        },
      },
      `Write ${language} code for language sample`,
    );
    const workspace = await page.evaluate(() => window.daemon.load());
    const artifact = workspace.artifacts.find((a) => !ids.includes(a.id));
    assert.equal(path.extname(artifact.name), extension);
    assert.equal(path.basename(artifact.path), artifact.name);
    if (language === "java") assert.equal(artifact.name, "Student.java");
    assert.ok(!artifact.name.includes("unsafe"));
    assert.equal(await readFile(artifact.path, "utf8"), content);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    assert.equal(await page.locator("pre").innerText(), content);
    await page.getByRole("button", { name: "Close dialog" }).click();
    await assert.rejects(
      page.evaluate((id) => window.daemon.openArtifact(id), artifact.id),
      /could execute code/,
    );
    await page
      .getByRole("button", { name: "Show in folder", exact: true })
      .click();
    assert.equal(
      (await app.evaluate(() => globalThis.languageReveals)).at(-1),
      artifact.path,
    );
    const savedCount = workspace.artifacts.length;
    for (const name of [
      "../escape" + extension,
      "payload.exe",
      "misleading.docx",
    ])
      await assert.rejects(
        page.evaluate(
          ({ a, name }) =>
            window.daemon.saveArtifact({ ...a, id: crypto.randomUUID(), name }),
          { a: artifact, name },
        ),
        /Invalid artifact/,
      );
    assert.equal(
      (await page.evaluate(() => window.daemon.load())).artifacts.length,
      savedCount,
    );
    if (language === "java") {
      await submit(
        {
          data: {
            action: "automate_vscode",
            language,
            filename: "Student.java",
            content,
          },
        },
        "Write Java code for language sample",
      );
      const duplicate = (
        await page.evaluate(() => window.daemon.load())
      ).artifacts.find(
        (a) => a.name === "Student.java" && a.id !== artifact.id,
      );
      assert.ok(duplicate);
      assert.notEqual(duplicate.path, artifact.path);
      assert.equal(path.basename(duplicate.path), "Student.java");
      assert.equal(await readFile(duplicate.path, "utf8"), content);
      assert.equal(await readFile(artifact.path, "utf8"), content);
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      assert.equal(await page.locator("pre").innerText(), content);
      await page.getByRole("button", { name: "Close dialog" }).click();
      await page
        .getByRole("button", { name: "Show in folder", exact: true })
        .click();
      assert.equal(
        (await app.evaluate(() => globalThis.languageReveals)).at(-1),
        duplicate.path,
      );
    }
  }
  const before = (await page.evaluate(() => window.daemon.load())).artifacts
    .length;
  await submit(
    {
      data: {
        action: "automate_canva",
        content: "project poster",
        filename: "",
      },
    },
    "Design a poster",
  );
  assert.match(
    await page.locator(".message.assistant").innerText(),
    /not supported/,
  );
  const failures = [
    [{ raw: "{bad" }, /malformed JSON/],
    [
      { data: { action: "automate_word", content: "text" } },
      /expected a supported action/,
    ],
    [
      { data: { action: "unknown", content: "text", filename: "x" } },
      /supported action/,
    ],
    [
      {
        data: {
          action: "automate_word",
          content: "Error: llama-server not running.",
          filename: "x",
        },
      },
      /Android brain/,
    ],
    [{ error: "TypeError" }, /Cannot reach/],
    [{ error: "AbortError" }, /timed out/],
    [{ status: 503, data: {} }, /HTTP error/],
    [{ raw: "html", type: "text/html" }, /not JSON/],
    [
      {
        data: {
          action: "automate_excel",
          content: "A,B\n1,2,3",
          filename: "x.xlsx",
        },
      },
      /consistent CSV/,
    ],
  ];
  for (const [fixture, error] of failures) {
    await submit(fixture, "Draft a document about failure");
    assert.match(await page.getByRole("alert").innerText(), error);
    assert.equal(
      (await page.evaluate(() => window.daemon.load())).artifacts.length,
      before,
    );
  }
  assert.match(
    await page.locator(".connection-pill").innerText(),
    /Connected|Connection|Device|ADB|Authorization|Forwarding|Brain|Select/,
  );
  await assert.rejects(
    page.evaluate(() =>
      window.daemon.generate({ prompt: "hello", url: "https://example.com" }),
    ),
    /Prompt must/,
  );
  await assert.rejects(
    page.evaluate(() => window.daemon.generate("x".repeat(12001))),
    /Prompt must/,
  );
  // A failed request releases the main-process lock; success can follow failure.
  await submit(
    {
      data: {
        action: "automate_vscode",
        content: 'print("Recovered")',
        filename: "x.py",
      },
    },
    "Write Python code for recovered request",
  );
  await page.getByText("recovered_request.py", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "My files", exact: true }).click();
  await page
    .getByRole("heading", { name: "recovered_request.py", exact: true })
    .waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/android-fixture-files.png" });
  console.log(
    "Android provider (stubbed main-process HTTP only): restricted IPC, prompt-only requests, all actions, file formats, UI-only controls, errors, loading cleanup, recovery and persistence passed. No physical inference was tested.",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await mkdir("test-results", { recursive: true });
    await page
      .screenshot({ path: "test-results/android-failure.png" })
      .catch(() => {});
  }
  throw error;
} finally {
  await devServer.close();
  await app?.close();
}
