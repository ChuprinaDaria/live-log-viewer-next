/* global Bun */
// Component rehearsal only: no Next build, Viewer server or runtime host.
// Run with bun scripts/verify-ui-consolidation.cjs; UI_TEST_WIDTH=320|390|430|1280.
const { chromium } = require("playwright-core");
const path = require("node:path");
const os = require("node:os");
const { compile } = require("@tailwindcss/node");
const fs = require("node:fs");
const http = require("node:http");
const assert = require("node:assert/strict");
(async () => {
  const repo = path.resolve(__dirname, "..");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "llv-ui-check-"));
  const width = Number(process.env.UI_TEST_WIDTH ?? 390);
  assert(
    [320, 390, 430, 1280].includes(width),
    "UI_TEST_WIDTH must be 320, 390, 430 or 1280",
  );
  const compiled = await Bun.build({
    entrypoints: [
      path.join(repo, "src/test-helpers/uiConsolidationFixture.tsx"),
    ],
    target: "browser",
    outdir: output,
    naming: "fixture.js",
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env": "{}",
      "process.env.NEXT_PUBLIC_RUNTIME_UI": '"0"',
    },
  });
  assert(compiled.success, compiled.logs.map(String).join("\n"));
  const css = await compile(
    fs.readFileSync(path.join(repo, "src/app/globals.css"), "utf8"),
    { base: path.join(repo, "src/app"), onDependency: () => {} },
  );
  const candidates = new Set();
  for (const file of new Bun.Glob("src/**/*.{tsx,ts}").scanSync({
    cwd: repo,
  })) {
    for (const token of fs
      .readFileSync(path.join(repo, file), "utf8")
      .match(/[^\s"'`<>]+/g) ?? [])
      candidates.add(token);
  }
  fs.writeFileSync(path.join(output, "style.css"), css.build([...candidates]));
  fs.writeFileSync(
    path.join(output, "index.html"),
    '<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
  );
  const server = http.createServer((req, res) => {
    const file = req.url.split("?")[0];
    const name =
      file === "/fixture.js"
        ? "fixture.js"
        : file === "/style.css"
          ? "style.css"
          : "index.html";
    res.setHeader(
      "Content-Type",
      name.endsWith(".js")
        ? "text/javascript"
        : name.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(fs.readFileSync(path.join(output, name)));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: width < 768,
      hasTouch: width < 768,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const roles = Array.from({ length: 16 }, (_, i) => ({
      id: i === 0 ? "builder" : `custom-${i}`,
      name: i === 0 ? "Будівельник" : `Роль ${i} — перевірка довгої назви`,
      description: "Перевірити форму та доступність усіх кнопок.",
      config: { engine: "codex", model: "gpt-6-astra", effort: "high" },
      promptScaffold: "Змінений текст\nДругий рядок\n".repeat(14),
      seedPromptScaffold: "Початковий текст\nДруга інструкція",
      edited: true,
      editable: i === 0,
      updatedAt: null,
    }));
    let failRoles = false;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (req.headers()["accept"] === "text/event-stream")
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: ": fixture\n\n",
        });
      let body = {};
      let status = 200;
      if (url.pathname === "/api/roles") {
        if (req.method() === "POST") {
          const change = req.postDataJSON(),
            role = roles.find((r) => r.id === change.role);
          role.promptScaffold = change.reset
            ? role.seedPromptScaffold
            : change.prompt;
          role.edited = !change.reset;
          body = { role };
        } else if (failRoles) {
          status = 503;
          body = { error: "offline" };
        } else body = { source: "fleetctl", roles };
      } else if (url.pathname === "/api/permissions")
        body = {
          target: "machine",
          settings: "fixture",
          defaultMode: null,
          allow: Array.from(
            { length: 54 },
            (_, i) => `mcp__example__a_long_rule_${i}`,
          ),
          deny: ["Bash(restricted:*)"],
          ask: [],
          protected_deny: [],
        };
      else if (url.pathname === "/api/accounts")
        body = {
          claude: {
            autoBalance: { enabled: false, revision: 1, thresholdPercent: 25 },
          },
          codex: {
            autoBalance: { enabled: false, revision: 1, thresholdPercent: 25 },
          },
        };
      else if (url.pathname === "/api/mcp-registry")
        body = { servers: [], skills: [], registry: "fixture" };
      else if (url.pathname === "/api/runtime/status")
        body = { enabled: false };
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto(origin);
    await page.locator("[data-mobile2-settings]").waitFor();
    assert.equal(await page.locator("[data-mobile2-tab]").count(), 3);
    await page.screenshot({ path: path.join(output, "settings.png") });
    await page.locator('[data-mobile2-go="permissions"]').click();
    await page.locator("[data-perm-rule]").first().waitFor();
    assert(await page.locator("[data-mobile2-back]").isVisible());

    const metrics = await page
      .locator("[data-mobile2-permissions]")
      .evaluate((e) => ({
        client: e.clientHeight,
        scroll: e.scrollHeight,
        first: e.querySelector("input")?.getBoundingClientRect().height,
      }));
    assert(metrics.scroll > metrics.client);
    assert(metrics.first >= 44);
    console.log("PERMISSIONS", metrics);
    await page.screenshot({ path: path.join(output, "permissions.png") });
    await page.locator("[data-perm-rule]").last().scrollIntoViewIfNeeded();
    assert(await page.locator("[data-perm-rule]").last().isVisible());
    await page.locator("[data-mobile2-back]").click();
    await page.locator('[data-mobile2-go="roles"]').click();
    await page.locator('[data-mobile2-role="builder"] > button').click();
    await page.locator('[data-mobile2-role-reset="builder"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector("textarea")?.value ===
        "Початковий текст\nДруга інструкція",
    );
    await page.locator("textarea").fill("Новий промпт\nВставлений рядок");
    await page.locator('[data-mobile2-role-save="builder"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-mobile2-role-save="builder"]')?.disabled,
    );
    await page.screenshot({ path: path.join(output, "roles.png") });
    await page
      .locator('[data-mobile2-role="custom-15"] > button')
      .scrollIntoViewIfNeeded();
    assert(
      await page
        .locator('[data-mobile2-role="custom-15"] > button')
        .isVisible(),
    );
    await page.locator('[data-mobile2-role="custom-15"] > button').click();
    assert.equal(await page.locator("textarea").getAttribute("readonly"), "");
    assert.equal(
      await page.locator('[data-mobile2-role-save="custom-15"]').count(),
      0,
    );
    failRoles = true;
    await page.getByRole("button", { name: "Оновити", exact: true }).click();
    await page.locator("[data-mobile2-roles-error]").waitFor();
    assert.equal(await page.locator("[data-mobile2-role]").count(), 16);
    console.log("ROLES reset/save/read-only/stale passed");
    await page.locator("[data-mobile2-back]").click();
    await page.locator('[data-mobile2-go="mcp"]').click();
    await page.locator("[data-mcp-add-open]").click();
    await page.locator('[data-mcp-field="name"]').fill("example-server");
    await page.locator("[data-mcp-env-key]").fill("EXAMPLE_KEY");
    await page.waitForTimeout(200);
    const pairFields = await page
      .locator('[data-mobile2-sheet="mcpAdd"] input')
      .evaluateAll((elements) =>
        elements
          .filter((el) => el.getBoundingClientRect().width)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right };
          }),
      );
    for (const rect of pairFields)
      assert(
        rect.left >= 0 && rect.right <= width,
        "MCP form field clips horizontally",
      );
    await page.screenshot({ path: path.join(output, "mcp-add.png") });
    await page.goto(origin + "/?screen=chat");
    await page.locator("textarea").waitFor();
    const text = page.getByRole("textbox", { name: "Повідомлення" });
    await text.fill("Запитай @ог");
    await page.getByRole("option").nth(1).waitFor();
    await page.screenshot({ path: path.join(output, "mentions.png") });
    await text.press("ArrowDown");
    await text.press("Enter");
    assert.equal(await text.inputValue(), "Запитай @Оглядач ");
    assert.equal(await page.locator("[data-sent]").count(), 0);
    await page.getByRole("button", { name: "Надіслати", exact: true }).click();
    assert(
      (
        await page.locator("[data-sent]").first().getAttribute("data-sent")
      ).includes("conversation_worker_b"),
    );
    await text.fill("Перший рядок\nДругий рядок\nТретій рядок");
    await text.press(width < 768 ? "Enter" : "Shift+Enter");
    assert((await text.inputValue()).endsWith("\n"));
    assert.equal(await page.locator("[data-sent]").count(), 1);
    await page.getByRole("button", { name: "Надіслати", exact: true }).click();
    assert.equal(await page.locator("[data-sent]").count(), 2);
    await text.fill("(@Rev");
    await page.getByRole("option", { name: /@Reviewer \[UI\]/ }).click();
    assert.equal(await text.inputValue(), "(@Reviewer-UI ");
    await page.getByRole("button", { name: "Надіслати", exact: true }).click();
    const mentionLink = page.locator(
      '[data-sent] a[href="#c=conversation_worker_ui"]',
    );
    assert.equal(await mentionLink.count(), 1);
    assert.equal(await mentionLink.textContent(), "@Reviewer-UI");
    await page.locator("[data-agent-action] > details > summary").click();
    assert(await page.locator("[data-agent-action-text]").isVisible());
    assert.equal(
      await page.locator("[data-agent-action]").getAttribute("data-delivery"),
      "queued",
    );
    await text.fill(
      "Багаторядковий текст для перевірки висоти й доступності кнопки надсилання.\n".repeat(
        10,
      ),
    );
    const beforeKeyboard = await page
      .getByRole("button", { name: "Надіслати", exact: true })
      .boundingBox();
    console.log("BEFORE KEYBOARD", beforeKeyboard);
    assert(beforeKeyboard.y + beforeKeyboard.height <= 844);
    await page.screenshot({ path: path.join(output, "chat-long.png") });
    if (width < 768)
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, "height", {
          configurable: true,
          value: 508,
        });
        visualViewport.dispatchEvent(new Event("resize"));
      });
    await page.waitForTimeout(150);
    const visibleHeight = width < 768 ? 508 : 844;
    const geometry = await page.evaluate(() => {
      const f = document.querySelector("textarea").getBoundingClientRect(),
        b = document
          .querySelector('button[aria-label="Надіслати"]')
          .getBoundingClientRect();
      return {
        field: { top: f.top, height: f.height, bottom: f.bottom },
        send: { top: b.top, bottom: b.bottom },
        windowScroll: scrollY,
      };
    });
    await page.screenshot({ path: path.join(output, "chat-keyboard.png") });
    await page.getByRole("button", { name: "Інші способи надсилання" }).click();
    const menu = page.getByRole("menu");
    const menuRect = await menu.boundingBox();
    assert(menuRect.y >= 0 && menuRect.y + menuRect.height <= visibleHeight);
    assert(menuRect.x >= 0 && menuRect.x + menuRect.width <= width);
    await page.getByRole("menuitem").press("Escape");
    assert.equal(await menu.count(), 0);
    console.log("KEYBOARD", geometry);
    assert(geometry.send.bottom <= visibleHeight);
    assert(geometry.send.top >= 52);
    assert.equal(geometry.windowScroll, 0);
    assert.deepEqual(errors, []);
    const controls = await page.locator("form button").evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      }),
    );
    for (const rect of controls.filter((r) => r.width && r.height)) {
      assert(
        rect.left >= 0 && rect.right <= width,
        "composer control clips horizontally",
      );
      assert(
        rect.top >= 52 && rect.bottom <= visibleHeight,
        "composer control clips under keyboard",
      );
    }
    console.log(
      `PASS: ${width}px navigation, scrolling, role read-back, mentions, multiline send and keyboard geometry. Artifacts: ${output}`,
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
