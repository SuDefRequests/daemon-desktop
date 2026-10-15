import assert from "node:assert/strict";

const greetings = [
  ["What's on your mind today", "?"],
  ["Ready when you are", "."],
  ["Let's make something worthwhile", "."],
  ["What are we figuring out today", "?"],
  ["A new idea starts here", "."],
  ["Let's get to work", "."],
  ["What would you like to explore today", "?"],
  ["Got something in mind", "?"],
];
export async function expectWelcome(page, name = "") {
  const heading = page.locator(".conversation-welcome h1");
  const expected = greetings.map(
    ([greeting, ending]) => `${greeting}${name ? `, ${name}` : ""}${ending}`,
  );
  await page.waitForFunction(
    (expected) =>
      expected.includes(
        document.querySelector(".conversation-welcome h1")?.textContent,
      ),
    expected,
  );
  const text = await heading.innerText();
  assert.ok(
    greetings.some(
      ([greeting, ending]) =>
        text === `${greeting}${name ? `, ${name}` : ""}${ending}`,
    ),
    text,
  );
  return text;
}
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
    await expectWelcome(page);
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
  // Deterministic random values exercise every option without flaky probability checks.
  for (let index = 0; index < greetings.length; index++) {
    await page.evaluate((index) => {
      window.originalGreetingRandom ??= Math.random;
      Math.random = () => (index + 0.5) / 8;
    }, index);
    try {
      await fresh();
      assert.equal(
        await expectWelcome(page),
        greetings[index][0] + greetings[index][1],
      );
    } finally {
      await page.evaluate(() => {
        Math.random = window.originalGreetingRandom;
      });
    }
  }
  const stable = await expectWelcome(page);
  await page
    .getByRole("textbox", { name: "Your prompt" })
    .fill("Typing should not change the greeting");
  await page.locator(".model-button").click();
  assert.equal(await expectWelcome(page), stable);
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Your prompt" }).fill("");
  await save("  Suraj  ");
  assert.equal(await input.inputValue(), "Suraj");
  await fresh();
  await expectWelcome(page, "Suraj");
  await page.screenshot({ path: "test-results/new-chat-personalized.png" });
  await page.reload();
  await page.getByRole("heading", { name: "VIDUR AI", exact: true }).waitFor();
  await fresh();
  await expectWelcome(page, "Suraj");
  await settings();
  assert.equal(await input.inputValue(), "Suraj");
  await save("   ");
  assert.equal(await input.inputValue(), "");
  await fresh();
  await expectWelcome(page);
  await save("Mira");
  await fresh();
  await expectWelcome(page, "Mira");
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
