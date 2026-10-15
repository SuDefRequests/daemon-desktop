import { createServer } from "vite";
import { expectWelcome } from "./new-chat.mjs";
import { stubArtifactApplications } from "./application-stubs.mjs";
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import presentation from "../electron/presentation.cjs";
import document from "../electron/document.cjs";
const { validatePptx } = presentation;
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
  await stubArtifactApplications(app, temp);
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
      "#include <iostream>\nint main() { int a,b,c; std::cin >> a >> b >> c; std::cout << a+b+c; }",
      "Open VS Code and write a C++ program to add three numbers.",
      "SumThreeNumbers.cpp",
    ],
    [
      "automate_vscode",
      "def factorial(n):\n    return 1 if n < 2 else n * factorial(n - 1)",
      "Create a Python file for factorial.",
      "factorial.py",
    ],
    [
      "automate_vscode",
      "int main() { return 0; }",
      "Create a file named BinarySearch.cpp.",
      "BinarySearch.cpp",
    ],
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
      "project_report.docx",
    ],
    [
      "automate_word",
      "# Virat Kohli\n\nReturned model biography text.",
      "create a word file for virat kohli",
      "virat_kohli.docx",
    ],
    [
      "automate_word",
      "Environmental management is the topic of this returned model paragraph.",
      "write an essay in Word about environmental management",
      "in_word_about_environmental.docx",
    ],
    [
      "automate_ppt",
      "# E-waste\n\n## Collection\n- Collect electronics separately.\n\n## Repair\n- Repair devices when practical.",
      "Create a presentation about project overview",
      "project_overview.pptx",
    ],
  ];
  fixtures.push(
    [
      "automate_word",
      "Formula 1 is the subject of this model essay.",
      "write essay in word about formula 1",
      "in_word_about_formula.docx",
    ],
    [
      "automate_word",
      "This second model essay discusses Formula 1.",
      "write essay in word about formula 1 and save as docx",
      "in_word_about_formula_2.docx",
    ],
  );
  for (const [action, content, prompt, name] of fixtures) {
    await submit(
      {
        data: {
          action,
          content,
          filename:
            action === "automate_vscode"
              ? "../../misleading" + path.extname(name)
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
    if (action === "automate_ppt") {
      const bytes = await readFile(artifact.path);
      const zip = await validatePptx(bytes, 3);
      assert.ok(
        (await zip.file("ppt/slides/slide2.xml").async("string")).includes(
          "Collect electronics separately.",
        ),
      );
      // Electron downloads are observed through its native session, rather than
      // Playwright's browser-only download handling.
      await app.evaluate(({ session }, destination) => {
        globalThis.pptxDownload = new Promise((resolve) => {
          session.defaultSession.once("will-download", (_event, item) => {
            item.setSavePath(destination);
            item.once("done", (_event, state) =>
              resolve({
                state,
                name: item.getFilename(),
                path: item.getSavePath(),
              }),
            );
          });
        });
      }, `${temp}/downloaded.pptx`);
      // Desktop cards expose Open/Reveal. Exercise the shared download helper
      // directly without adding another UI control for this task.
      await page.evaluate(async (artifact) => {
        const { downloadArtifact } = await import("/src/storage.ts");
        await downloadArtifact(artifact);
      }, artifact);
      const downloaded = await app.evaluate(() =>
        Promise.race([
          globalThis.pptxDownload,
          new Promise((_resolve, reject) =>
            setTimeout(
              () => reject(new Error("Electron download did not complete")),
              10000,
            ),
          ),
        ]),
      );
      assert.equal(downloaded.state, "completed");
      assert.equal(downloaded.name, name);
      assert.deepEqual(await readFile(downloaded.path), bytes);
      assert.equal(artifact.content, content);
      assert.equal(artifact.presentationStatus, "unknown");
    } else if (action === "automate_word") {
      const bytes = await readFile(artifact.path);
      const zip = await document.validateDocx(bytes);
      const xml = await zip.file("word/document.xml").async("string");
      for (const line of content
        .split("\n")
        .map((line) => line.replace(/^(?:#+|[-*])\s+/, "").trim())
        .filter(Boolean))
        assert.ok(xml.includes(line));
      const downloaded = await page.evaluate(
        async (id) =>
          Array.from(new Uint8Array(await window.daemon.readDocument(id))),
        artifact.id,
      );
      assert.deepEqual(Buffer.from(downloaded), bytes);
    } else assert.equal(await readFile(artifact.path, "utf8"), content);
    const auto = await app.evaluate(() => globalThis.daemonAppActions);
    assert.equal(
      auto.filter(([, target]) => target === artifact.path).length,
      1,
    );
    assert.equal(
      auto.at(-1)[0],
      action === "automate_vscode" ? "vscode" : "default",
    );
    const duplicate = await page.evaluate(
      (a) => window.daemon.saveArtifact(a),
      artifact,
    );
    assert.equal(duplicate.id, artifact.id);
    assert.equal(duplicate.opening.status, "already-saved");
    assert.deepEqual(
      await app.evaluate(() => globalThis.daemonAppActions),
      auto,
    );
    if (action === "automate_word")
      await page
        .getByRole("button", {
          name: "Open document (default app)",
          exact: true,
        })
        .waitFor();
    if (action === "automate_ppt")
      await page
        .getByRole("button", {
          name: "Open presentation (default app)",
          exact: true,
        })
        .waitFor();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    assert.equal(await page.locator("pre").innerText(), content);
    await page.getByRole("button", { name: "Close dialog" }).click();
  }
  await submit(
    {
      data: {
        action: "automate_ppt",
        filename: "partial.pptx",
        content:
          "Recycling devices can recover materials. Another thought that was cut",
        generation_status: "partial",
      },
    },
    "Make a PPT about recycling",
  );
  assert.match(
    await page.locator(".message.assistant").innerText(),
    /Partial model output/,
  );
  const partialArtifact = (
    await page.evaluate(() => window.daemon.load())
  ).artifacts.find((a) => a.name === "ppt_about_recycling.pptx");
  assert.ok(partialArtifact);
  assert.equal(partialArtifact.presentationStatus, "partial");
  const partialZip = await validatePptx(await readFile(partialArtifact.path));
  assert.ok(
    (await partialZip.file("ppt/slides/slide1.xml").async("string")).includes(
      "Another thought that was cut",
    ),
  );
  const failedSaveCount = (await page.evaluate(() => window.daemon.load()))
    .artifacts.length;
  await assert.rejects(
    page.evaluate(
      (a) =>
        window.daemon.saveArtifact({
          ...a,
          id: crypto.randomUUID(),
          name: "invalid.pptx",
          content: "{}",
        }),
      partialArtifact,
    ),
    /No usable presentation/,
  );
  assert.equal(
    (await page.evaluate(() => window.daemon.load())).artifacts.length,
    failedSaveCount,
  );
  await assert.rejects(
    page.evaluate(() => window.daemon.readPresentation("../../unregistered")),
    /File not found/,
  );
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
    assert.equal(
      (await app.evaluate(() => globalThis.daemonAppActions)).filter(
        ([, target]) => target === artifact.path,
      ).length,
      1,
    );
    await page
      .getByRole("button", { name: "Open in VS Code", exact: true })
      .click();
    assert.deepEqual(
      (await app.evaluate(() => globalThis.daemonAppActions)).at(-1),
      ["vscode", artifact.path],
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
  // Save twice to exercise stylesheet collisions and real HTML references.
  for (let iteration = 1; iteration <= 2; iteration++) {
    const suffix = iteration === 1 ? "" : "_2";
    const beforeOpens = await app.evaluate(
      () => globalThis.daemonAppActions.length,
    );
    await submit(
      {
        data: {
          action: "automate_vscode",
          language: "html",
          website: true,
          filename: "index.html",
          content:
            '```html\n<html><head><link rel="stylesheet" href="styles.css"></head><body>Model bakery content</body></html>\n```\n```css\nbody { color: brown; }\n```',
        },
      },
      "make a simple html css website for a bakery shop",
    );
    await page.getByText(`index${suffix}.html`, { exact: true }).waitFor();
    await page.getByText(`styles${suffix}.css`, { exact: true }).waitFor();
    assert.equal(await page.locator(".artifact-inline").count(), 2);
    const ws = await page.evaluate(() => window.daemon.load());
    const html = ws.artifacts.find((a) => a.name === `index${suffix}.html`);
    const css = ws.artifacts.find((a) => a.name === `styles${suffix}.css`);
    assert.match(
      await readFile(html.path, "utf8"),
      new RegExp(`href="styles${suffix}\\.css"`),
    );
    assert.equal(await readFile(css.path, "utf8"), "body { color: brown; }");
    const opens = await app.evaluate(() => globalThis.daemonAppActions);
    assert.equal(opens.length, beforeOpens + 2);
    assert.ok(JSON.stringify(opens.at(-1)).includes(html.path));
  }
  await app.evaluate(() => {
    globalThis.daemonCodeError = "VS Code launcher unavailable (fixture)";
  });
  await submit(
    {
      data: {
        action: "automate_vscode",
        content: "int main() { return 42; }",
        filename: "ignored.cpp",
        language: "cpp",
      },
    },
    "Open VS Code and write C++ code for launch failure",
  );
  assert.match(
    await page.getByRole("alert").innerText(),
    /Saved LaunchFailure.cpp.*Automatic opening failed.*VS Code launcher unavailable/,
  );
  const savedCode = (
    await page.evaluate(() => window.daemon.load())
  ).artifacts.find((a) => a.name === "LaunchFailure.cpp");
  assert.ok(savedCode);
  assert.equal(
    await readFile(savedCode.path, "utf8"),
    "int main() { return 42; }",
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Your prompt" }).inputValue(),
    "",
  );
  await page
    .getByRole("button", { name: "Open in VS Code", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  assert.equal(await page.locator("pre").innerText(), savedCode.content);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await app.evaluate(() => {
    globalThis.daemonCodeError = "";
  });
  await app.evaluate(() => {
    globalThis.daemonOpenError = "No associated document application (fixture)";
  });
  await submit(
    {
      data: {
        action: "automate_word",
        content: "Actual model text retained despite an opening failure.",
        filename: "ignored.docx",
      },
    },
    "Create a Word document about opening failure",
  );
  assert.match(
    await page.getByRole("alert").innerText(),
    /Saved opening_failure.docx.*Automatic opening failed.*No associated/,
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Your prompt" }).inputValue(),
    "",
  );
  const failedOpenArtifact = (
    await page.evaluate(() => window.daemon.load())
  ).artifacts.find((a) => a.name === "opening_failure.docx");
  assert.ok(failedOpenArtifact);
  await document.validateDocx(await readFile(failedOpenArtifact.path));
  assert.equal(
    (await app.evaluate(() => globalThis.daemonAppActions)).filter(
      ([, target]) => target === failedOpenArtifact.path,
    ).length,
    1,
  );
  await app.evaluate(() => {
    globalThis.daemonOpenError = "";
  });
  await page
    .getByRole("button", { name: "Open document (default app)", exact: true })
    .click();
  await page
    .getByText("Open request sent to the default application.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  assert.equal(
    await page.locator("pre").innerText(),
    failedOpenArtifact.content,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
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
    [
      { data: { action: "automate_ppt", filename: "empty.pptx", content: "" } },
      /empty content/,
    ],
    [
      {
        data: {
          action: "automate_ppt",
          filename: "invalid.pptx",
          content: "{broken output",
        },
      },
      /No usable presentation/,
    ],
    [
      {
        data: {
          action: "automate_ppt",
          filename: "timeout.pptx",
          content: "Error: AI timed out.",
        },
      },
      /Android brain/,
    ],
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
