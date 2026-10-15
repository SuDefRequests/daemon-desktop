import assert from "node:assert/strict";

export async function verifySidebar(page, resize) {
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  async function settle(width) {
    await page.waitForFunction(
      (width) =>
        Math.abs(
          document.querySelector(".sidebar").getBoundingClientRect().width -
            width,
        ) < 0.1,
      width,
    );
    await page.locator(".sidebar").evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  }
  // Sample actual geometry through the transition, not just its final CSS class.
  const samples = await page.evaluate(async () => {
    const samples = [],
      start = performance.now();
    document.querySelector(".sidebar-toggle").click();
    do {
      await new Promise(requestAnimationFrame);
      const sidebar = document
        .querySelector(".sidebar")
        .getBoundingClientRect();
      const icon = document
        .querySelector("nav button svg")
        .getBoundingClientRect();
      samples.push({
        width: sidebar.width,
        edge: sidebar.right,
        main: document.querySelector("main").getBoundingClientRect().left,
        iconX: icon.x,
        iconY: icon.y,
        opacity: Number(
          getComputedStyle(document.querySelector("nav button span")).opacity,
        ),
      });
    } while (performance.now() - start < 320);
    return samples;
  });
  assert.ok(
    samples.some((sample) => sample.width > 65 && sample.width < 269),
    "Width interpolates",
  );
  assert.ok(
    samples.some((sample) => sample.opacity > 0 && sample.opacity < 1),
    "Labels fade",
  );
  for (const sample of samples) {
    assert.ok(
      Math.abs(sample.edge - sample.main) < 1,
      "Main content follows sidebar without overlap",
    );
    assert.ok(
      Math.abs(sample.iconX - samples[0].iconX) <= 8,
      "Icon inset follows the narrower rail smoothly",
    );
    assert.ok(
      sample.iconY >= samples[0].iconY - 1 &&
        sample.iconY <= samples[0].iconY + 49,
      "Navigation follows the reserved search row during collapse",
    );
  }
  await settle(64);
  assert.equal(
    await page.locator(".sidebar-toggle").getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(
    await page.locator(".recent").evaluate((element) => element.inert),
    true,
  );
  for (const [name, heading] of [
    ["My files", "My files"],
    ["Device & model", "Device & model"],
    ["Settings", "Settings"],
    ["Home", "VIDUR AI"],
  ]) {
    const button = navigation.getByRole("button", { name, exact: true });
    assert.equal(await button.getAttribute("title"), name);
    const bounds = await button.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44);
    await button.click();
    assert.equal(await button.getAttribute("aria-current"), "page");
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  }
  assert.equal(
    await page
      .getByRole("button", { name: "New chat", exact: true })
      .getAttribute("title"),
    "New chat",
  );
  await navigation
    .getByRole("button", { name: "Settings", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".connection-pill")
      .evaluate((element) => element === document.activeElement),
    true,
    "Hidden sidebar controls are skipped by keyboard navigation",
  );
  await page.screenshot({ path: "test-results/sidebar-collapsed.png" });

  const logo = page.getByRole("button", {
    name: "Expand sidebar",
    exact: true,
  });
  const searchButton = page.getByRole("button", {
    name: "Search conversations",
    exact: true,
  });
  const searchField = page.getByRole("textbox", {
    name: "Search conversations",
    exact: true,
  });
  assert.equal(await logo.getAttribute("title"), "Open sidebar");
  assert.equal(
    await searchButton.getAttribute("title"),
    "Search conversations",
  );
  await logo.click();
  await settle(270);
  assert.equal(
    await page.locator(".brand-logo img").getAttribute("src"),
    "./daemon-logo.svg",
  );
  await searchButton.click();
  assert.equal(
    await searchField.evaluate((element) => element === document.activeElement),
    true,
  );
  await searchField.fill("Sidebar search probe");
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await settle(64);
  await searchButton.focus();
  await page.keyboard.press("Enter");
  await settle(270);
  await page.waitForFunction(
    () => document.activeElement?.id === "conversation-search",
  );
  assert.equal(
    await searchField.inputValue(),
    "Sidebar search probe",
    "Search query survives collapsing and reopening",
  );
  await searchField.fill("");
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await settle(64);
  await logo.focus();
  await page.keyboard.press("Space");
  await settle(270);
  assert.equal(
    await page
      .locator(".sidebar-toggle")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await settle(64);

  const rail = await page.evaluate(() => {
    const rect = (selector) =>
      document.querySelector(selector).getBoundingClientRect();
    const selectors = [
      ".brand-logo",
      ".new-chat",
      ".sidebar-search",
      "nav button",
    ];
    return selectors.map((selector) => {
      const r = rect(selector);
      return { centerX: r.x + r.width / 2, centerY: r.y + r.height / 2 };
    });
  });
  assert.ok(
    rail.every((item) => Math.abs(item.centerX - rail[0].centerX) < 1),
    "Collapsed controls share one center line",
  );
  const steps = rail
    .slice(1)
    .map((item, index) => item.centerY - rail[index].centerY);
  assert.ok(
    steps.every((step) => step >= 44 && step <= 56),
    "Logo, New chat, search and Home have a compact, consistent rhythm",
  );

  // Reverse direction before animations finish; the end state must remain usable.
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      document
        .querySelector(
          document.querySelector(".app").classList.contains("sidebar-collapsed")
            ? ".brand-logo"
            : ".sidebar-toggle",
        )
        .click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }
  });
  await settle(270);
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  assert.equal(
    await page.locator(".recent").evaluate((element) => element.inert),
    false,
  );
  assert.equal(
    await page.locator(".sidebar-toggle").getAttribute("aria-expanded"),
    "true",
  );

  await page.mouse.move(800, 50);
  await navigation
    .getByRole("button", { name: "Home", exact: true })
    .evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  assert.equal(
    await navigation
      .getByRole("button", { name: "Home", exact: true })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(41, 44, 48)",
    "Active navigation styling remains visible",
  );
  const alignment = await page.evaluate(() => {
    const rect = (selector) =>
      document.querySelector(selector).getBoundingClientRect();
    const action = rect(".new-chat"),
      home = rect("nav button"),
      brand = rect(".brand");
    return {
      actionIcon: rect(".new-chat svg").left,
      homeIcon: rect("nav button svg").left,
      actionLabel: rect(".new-chat span").left,
      homeLabel: rect("nav button span").left,
      rowGap: home.top - action.bottom,
      headerGap: action.top - brand.bottom,
      actionHeight: action.height,
      homeHeight: home.height,
    };
  });
  assert.equal(alignment.actionIcon, alignment.homeIcon);
  assert.equal(alignment.actionLabel, alignment.homeLabel);
  assert.equal(alignment.actionHeight, alignment.homeHeight);
  assert.equal(alignment.rowGap, 4, "New chat uses the navigation row gap");
  assert.equal(
    alignment.headerGap,
    16,
    "Header does not add an oversized spacer",
  );

  if (resize) {
    for (const width of [850, 1150, 1440]) {
      await page.setViewportSize({ width, height: 940 });
      await settle(width <= 1150 ? 235 : 270);
      await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await settle(64);
      await navigation
        .getByRole("button", { name: "My files", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "My files", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Expand sidebar" }).click();
      await settle(width <= 1150 ? 235 : 270);
      assert.equal(
        await page
          .locator(".sidebar")
          .evaluate((element) => element.scrollHeight > element.clientHeight),
        false,
        "Sidebar fits supported window heights",
      );
    }
    await page.setViewportSize({ width: 850, height: 650 });
    await settle(235);
    assert.equal(
      await page
        .locator(".sidebar")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 940 });
    await settle(270);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await settle(64);
  assert.equal(
    await page
      .locator(".sidebar")
      .evaluate((element) => getComputedStyle(element).transitionDuration),
    "0s",
  );
  assert.equal(
    await navigation
      .locator("button span")
      .first()
      .evaluate((element) => getComputedStyle(element).visibility),
    "hidden",
  );
  await searchButton.click();
  await settle(270);
  await page.waitForFunction(
    () => document.activeElement?.id === "conversation-search",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await page.screenshot({ path: "test-results/sidebar-expanded.png" });
  console.log(
    "Sidebar: logo expansion, search focus/query retention, animated geometry, label fades, compact navigation/tooltips, rapid toggles, keyboard access, supported sizes and reduced motion passed.",
  );
}
