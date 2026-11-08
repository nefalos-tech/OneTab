import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ACTIONS, SITUATIONS } from "../src/client/catalog";
import { deriveResultView, deriveRoomView } from "../src/client/checkout-view";
import { FIXTURES, fixtureCases, personaParam } from "../src/client/fixtures";
import { formatMoney, splitEqually, toTokenUnits } from "../src/client/units";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function expectBefore(first: Locator, second: Locator) {
  const handle = await second.elementHandle();
  expect(await first.evaluate((a, b) => Boolean(b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), handle)).toBe(true);
}

async function expectEveryAmountLabeled(page: Page) {
  const amounts = await page.locator("[data-amount]").all();
  expect(amounts.length).toBeGreaterThan(0);
  for (const amount of amounts) await expect(amount).toContainText("test USDC");
}

for (const c of fixtureCases()) {
  const owner = SITUATIONS[c.situation].owner;
  test(`${c.id} on its ${owner} screen`, async ({ page }) => {
    const response = await page.goto(c.state.source.links[owner]);
    expect(response?.status()).toBe(200);

    const view = owner === "room" ? deriveRoomView(c.state) : deriveResultView(c.state);
    await expect(page.locator("[data-situation]")).toHaveAttribute("data-situation", c.situation);
    await expect(page.locator("[data-status-label]")).toHaveText(SITUATIONS[c.situation].label);
    await expect(page.locator("[data-status-line]")).toHaveText(view.status.line);
    await expect(page.getByRole("complementary", { name: "Sample data" })).toBeVisible();

    const primary = page.locator("[data-action='primary']");
    expect(await primary.count()).toBeLessThanOrEqual(1);
    if (view.actions.primary) await expect(primary).toContainText(ACTIONS[view.actions.primary.kind].label);
    if ("body" in view && view.body.kind === "needs_attention" && view.body.detail) {
      const reason = page.getByText(view.body.detail, { exact: true });
      await expect(reason).toBeVisible();
      await expectBefore(page.locator("[data-status-line]"), reason);
      await expectBefore(reason, page.locator("[data-action]").first());
    }
    await expectEveryAmountLabeled(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/screens/${c.id}.png`, fullPage: true });
  });
}

for (const [name, entry] of Object.entries(FIXTURES)) {
  const owner = SITUATIONS[entry.situation].owner;
  test(`${name} links from its ${owner === "room" ? "result" : "room"} screen to its ${owner} screen`, async ({ page }) => {
    const c = fixtureCases().find((x) => x.fixture === name && personaParam(x.persona) === personaParam(entry.defaultPersona));
    if (!c) throw new Error(`No default case for ${name}`);
    const { room, result } = c.state.source.links;
    await page.goto(owner === "room" ? result : room);
    const label =
      owner === "room" ? ACTIONS.back_to_checkout.label : entry.situation === "paid" ? ACTIONS.view_receipt.label : ACTIONS.view_status.label;
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(owner === "room" ? room : result);
    await expect(page.locator("[data-situation]")).toHaveAttribute("data-situation", entry.situation);
  });
}

test("the room's primary action sits above the payer list when stacked, and beside the tab card when wide", async ({ page }) => {
  const cases = fixtureCases().filter((c) => SITUATIONS[c.situation].owner === "room" && deriveRoomView(c.state).actions.primary);
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(c.state.source.links.room);
    const action = page.locator("[data-action='primary']");
    await expect(action, c.id).toBeVisible();
    const primary = await action.boundingBox();
    const payers = await page.getByRole("heading", { name: "Payers", exact: true }).boundingBox();
    expect(primary!.y, c.id).toBeLessThan(payers!.y);

    await page.setViewportSize({ width: 1280, height: 800 });
    const tab = await page.locator("[data-surface='brand']").boundingBox();
    const status = await page.locator("[data-situation]").boundingBox();
    expect(status!.x, c.id).toBeGreaterThan(tab!.x + tab!.width);
    expect(status!.y, c.id).toBe(tab!.y);
    expect((await page.getByRole("heading", { name: "Payers", exact: true }).boundingBox())!.y, c.id).toBeGreaterThan(tab!.y + tab!.height);
  }
});

test("the header wallet control shows the persona's short address, or Connect wallet when signed out", async ({ page }) => {
  const signedIn = fixtureCases().find((c) => c.state.source.links.room === "/checkouts/sample-signing?as=spot-2");
  const wallet = signedIn!.state.session!.wallet;
  await page.goto(signedIn!.state.source.links.room);
  const account = page.getByRole("banner").getByRole("button", { name: `Signed in as ${wallet.slice(0, 4)}…${wallet.slice(-4)}` });
  await expect(account).toHaveAttribute("aria-expanded", "false");

  await page.goto("/checkouts/sample-signing?as=signed-out");
  await expect(page.getByRole("banner").getByRole("button", { name: ACTIONS.connect_wallet.label })).toBeVisible();
});

test("a stubbed action announces that nothing was sent and stays put", async ({ page }) => {
  await page.goto("/checkouts/sample-signing?as=spot-2");
  await page.getByRole("button", { name: ACTIONS.approve.label }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approve in wallet isn't connected in sample data. Nothing was sent." })).toBeVisible();
  await expect(page).toHaveURL(/\/checkouts\/sample-signing\?as=spot-2$/);
});

test("at 320px the approval summary keeps a long share's digits on one line and stays on screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/checkouts/sample-signing?as=spot-2");
  const total = toTokenUnits(10_000_000_001n);
  const share = formatMoney({ units: splitEqually(total, 3)[1]!, decimals: 6 });
  expect(share).toBe("3,333.333334");
  const panel = page.locator("[data-situation]");
  const hero = panel.locator("[data-amount]").first();
  // Sample data has no amount this long, so the test puts one into the rendered summary.
  const setDigits = (amount: Locator, text: string) =>
    amount.evaluate((el, digits) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (/\d/.test(node.textContent ?? "")) node.textContent = digits;
    }, text);
  await setDigits(hero, share);
  await setDigits(panel.locator("dd [data-amount]"), formatMoney({ units: total, decimals: 6 }));
  await expect(hero).toHaveText(`${share} test USDC`);

  const digitLines = await hero.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/\d/.test(node.textContent ?? "")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    }
    return 0;
  });
  expect(digitLines, "the share's digits sit on one line").toBe(1);
  const edges = await panel.evaluate((el) => ({
    panel: el.getBoundingClientRect().right,
    content: Math.max(...[...el.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right)),
  }));
  expect(edges.panel, "the status panel fits the screen").toBeLessThanOrEqual(320);
  expect(edges.content, "nothing runs past the status panel's edge").toBeLessThanOrEqual(edges.panel);
  await panel.screenshot({ path: "test-results/screens/approval-summary-320.png" });
});

test("Copy link copies the room address and confirms it", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/checkouts/sample-open-spots?as=spot-1");
  await page.getByRole("button", { name: ACTIONS.copy_link.label }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied." })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/checkouts/sample-open-spots?as=spot-1`);
});

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error("Tab never reached the target");
}

test("the sample create flow works by keyboard alone", async ({ page }) => {
  await page.goto("/?sample");
  await tabTo(page, page.getByLabel("Checkout name"));
  await page.keyboard.type("Cabin weekend groceries");
  await tabTo(page, page.getByLabel("Seller wallet"));
  await page.keyboard.type(FIXTURES.paid.snapshot.checkout.sellerWallet);
  await tabTo(page, page.getByLabel("Total in test USDC"));
  await page.keyboard.type("10");
  await tabTo(page, page.getByLabel("2 payers"));
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("3 payers")).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: ACTIONS.review_checkout.label }));
  await page.keyboard.press("Enter");

  const shares = page.getByRole("region", { name: "Each payer's share" });
  await expect(shares.getByText("3.333334 test USDC")).toHaveCount(1);
  await expect(shares.getByText("3.333333 test USDC")).toHaveCount(2);
  await expectNoAxeViolations(page);

  await tabTo(page, page.getByRole("button", { name: ACTIONS.edit_details.label }));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Total in test USDC")).toHaveValue("10");
  await expect(page.getByLabel("3 payers")).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: ACTIONS.review_checkout.label }));
  await page.keyboard.press("Enter");

  await tabTo(page, page.getByRole("button", { name: ACTIONS.create_checkout.label }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Create checkout isn't connected in sample data. Nothing was created." })).toBeVisible();
  await tabTo(page, page.getByRole("link", { name: ACTIONS.open_sample_room.label }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/checkouts\/sample-open-spots\?as=spot-1$/);
  await expect(page.locator("[data-situation]")).toHaveAttribute("data-situation", "open_spots");
});

test("the create form explains a problem when a field loses focus", async ({ page }) => {
  await page.goto("/?sample");
  await page.getByLabel("Seller wallet").fill("not a wallet");
  await page.getByLabel("Seller wallet").blur();
  await expect(page.getByLabel("Seller wallet")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("This isn't a Solana wallet address.")).toBeVisible();
  await page.getByLabel("Total in test USDC").fill("24.5");
  await expect(page.getByRole("region", { name: "Your checkout" }).getByText("12.25 test USDC")).toHaveCount(2);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: "test-results/screens/create.png", fullPage: true });
});

test("/samples lists every case", async ({ page }) => {
  await page.goto("/samples");
  for (const c of fixtureCases()) {
    const owner = SITUATIONS[c.situation].owner;
    await expect(page.locator(`a[href="${c.state.source.links[owner]}"]`)).toHaveCount(1);
  }
  await expectNoAxeViolations(page);
  await page.screenshot({ path: "test-results/screens/samples.png", fullPage: true });
});

test("plain / says creation is unavailable and offers the samples", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Checkouts can't be created right now");
  await expect(page.getByRole("link", { name: "Try it with sample data" })).toHaveAttribute("href", "/?sample");
  await expectNoAxeViolations(page);
});

test("a real checkout ID never falls back to sample data, even with samples on", async ({ page }) => {
  const response = await page.goto(`/checkouts/${FIXTURES.signing.snapshot.checkout.id}?as=spot-2`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Sample data")).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: "test-results/screens/not-found.png", fullPage: true });
});
