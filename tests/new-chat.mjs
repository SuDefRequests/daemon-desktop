import assert from "node:assert/strict";

export async function verifyNewChatPreferences(page) {
  const workspace = () =>
    page.evaluate(async () =>
      window.daemon
        ? window.daemon.load()
        : JSON.parse(localStorage.getItem("daemon-workspace-v1")),
    );
  const before = await workspace();
  const home = () =>
    page.getByRole("button", { name: "Home", exact: true }).click();
  const fresh = () =>
    page.getByRole("button", { name: "New chat", exact: true }).click();
  const settings = () =>
    page.getByRole("button", { name: "Settings", exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "Preferred name",
    exact: true,
  });
  async function save(value) {
    await settings();
    await page.waitForFunction(
      () => !document.querySelector("#preferred-name").disabled,
    );
    await input.fill(value);
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await page.getByText("Preferred name saved.", { exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.querySelector("#preferred-name").disabled,
    );
  }
  await home();
  await page.getByRole("heading", { name: "VIDUR AI", exact: true }).waitFor();
  assert.equal(await page.locator(".productivity-card").count(), 4);
  for (const screen of ["Home", "My files", "Device & model", "Settings"]) {
    await page.getByRole("button", { name: screen, exact: true }).click();
    await fresh();
    await page
      .getByRole("heading", { name: "Where shall we begin?", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator(
          ".message, .loading, .productivity-card, .quick-tools, .welcome",
        )
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("textbox", { name: "Your prompt" }).inputValue(),
      "",
    );
    await page.waitForFunction(
      () => document.activeElement === document.querySelector("textarea"),
    );
  }
  await save("  Suraj  ");
  assert.equal(await input.inputValue(), "Suraj");
  await fresh();
  await page
    .getByRole("heading", { name: "Where shall we begin, Suraj?", exact: true })
    .waitFor();
  await page.screenshot({ path: "test-results/new-chat-personalized.png" });
  await page.reload();
  await page.getByRole("heading", { name: "VIDUR AI", exact: true }).waitFor();
  await fresh();
  await page
    .getByRole("heading", { name: "Where shall we begin, Suraj?", exact: true })
    .waitFor();
  await settings();
  assert.equal(await input.inputValue(), "Suraj");
  await save("   ");
  assert.equal(await input.inputValue(), "");
  await fresh();
  await page
    .getByRole("heading", { name: "Where shall we begin?", exact: true })
    .waitFor();
  await save("Mira");
  await fresh();
  await page
    .getByRole("heading", { name: "Where shall we begin, Mira?", exact: true })
    .waitFor();
  assert.deepEqual(
    await workspace(),
    before,
    "Greetings and preference changes never create messages, artifacts or conversations",
  );
  if (await page.evaluate(() => !!window.daemon)) {
    for (const invalid of [
      { name: "Injected" },
      "x".repeat(81),
      "Invalid\0Name",
    ])
      await assert.rejects(
        page.evaluate(
          (value) => window.daemon.setPreferredName(value),
          invalid,
        ),
        /Preferred name/,
      );
    assert.equal(
      await page.evaluate(
        async () => (await window.daemon.getPreferences()).preferredName,
      ),
      "Mira",
    );
  }
  if (!(await page.evaluate(() => !!window.daemon))) {
    await page.addInitScript(() => {
      const mode = sessionStorage.getItem("preferences-service-fixture");
      if (!mode) return;
      window.daemon = {
        load: async () =>
          JSON.parse(localStorage.getItem("daemon-workspace-v1")),
        getInferenceConfig: async () => ({ provider: "mock" }),
        getOutputDirectory: async () => "Test output",
      };
      if (mode === "pending")
        window.daemon.getPreferences = () =>
          new Promise((resolve) => {
            window.finishPreferenceLoad = resolve;
          });
      if (mode === "old-main")
        window.daemon.getPreferences = async () => {
          throw new Error("No handler registered for 'preferences:get'");
        };
    });
    for (const mode of ["old-preload", "old-main", "pending"]) {
      await page.evaluate(
        (mode) => sessionStorage.setItem("preferences-service-fixture", mode),
        mode,
      );
      await page.reload();
      await page
        .getByRole("heading", { name: "VIDUR AI", exact: true })
        .waitFor();
      await settings();
      assert.equal(
        await input.isEnabled(),
        true,
        "A loading or failed preferences service must not lock name entry",
      );
      await input.fill("A name I can type");
      if (mode === "pending") {
        await page.waitForFunction(
          () => typeof window.finishPreferenceLoad === "function",
        );
        await page.evaluate(() =>
          window.finishPreferenceLoad({ preferredName: "Mira" }),
        );
        await page
          .getByText("Loading saved name…", { exact: true })
          .waitFor({ state: "hidden" });
        assert.equal(
          await input.inputValue(),
          "A name I can type",
          "Slow loading never replaces text already entered",
        );
      } else {
        await page
          .locator("#preferred-name-error")
          .getByText(/Close VIDUR AI completely and restart/)
          .waitFor();
        await page
          .getByRole("button", { name: "Retry loading", exact: true })
          .click();
        await page
          .locator("#preferred-name-error")
          .getByText(/Close VIDUR AI completely and restart/)
          .waitFor();
        assert.equal(await input.inputValue(), "A name I can type");
      }
    }
    await page.evaluate(() =>
      sessionStorage.removeItem("preferences-service-fixture"),
    );
    await page.reload();
    await settings();
    await page.waitForFunction(
      () => document.querySelector("#preferred-name").value === "Mira",
    );
  }
  await home();
  console.log(
    "New chat: distinct welcome, empty draft from every view, no automatic messages, optional trimmed name, save/reload, name updates and preserved history passed.",
  );
}
