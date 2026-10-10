import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp = await mkdtemp(path.join(os.tmpdir(), "daemon-android-fixtures-"));
let app, page;
try {
  app = await electron.launch({
    args: [".", `--user-data-dir=${temp}/profile`],
    env: {
      ...process.env,
      DAEMON_DEV: "1",
      DAEMON_PROVIDER: "android",
      DAEMON_SAVE_DIR: `${temp}/output`,
    },
  });
  page = await app.firstWindow();
  await page.getByRole("heading", { name: "DAEMON", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector("textarea").disabled,
  );
  assert.equal(
    (await page.evaluate(() => window.daemon.getInferenceConfig())).provider,
    "android",
  );
  assert.match(
    await page.locator(".connection-pill").innerText(),
    /unverified/,
  );
  await app.evaluate(() => {
    globalThis.daemonRequests = [];
    globalThis.daemonFixture = {};
    // Intercept in main: no request is made to a phone or a local service.
    globalThis.fetch = async (url, options) => {
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
  await page.locator(".model-button").click();
  await page
    .getByRole("button", { name: /DAEMON Compact — Demo option/ })
    .click();
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
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    assert.match(
      await page.locator(".model-button").innerText(),
      /DAEMON Compact/,
    );
    assert.match(await page.locator(".thinking-button").innerText(), /Middle/);
    await page.getByRole("textbox", { name: "Your prompt" }).fill(prompt);
    await page.getByRole("button", { name: "Send prompt" }).click();
    await page
      .getByText("Waiting for the Android brain…", { exact: true })
      .waitFor();
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
      { data: { action, content, filename: "../../misleading.docx" } },
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
    /unverified/,
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
  await app?.close();
}
