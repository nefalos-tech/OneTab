import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { SITUATIONS } from "../src/client/catalog";
import { shortAddress } from "../src/client/checkout-view";
import { parseRoomSnapshot } from "../src/client/contracts";
import { expect, test } from "./browser-api";
import { FAKE_API, LIVE, ROOMS, SCRIPT, WALLETS, freshCountedRoom, nextStep, scriptedRoom } from "./fake-api.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function capture(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.screenshot({ path: `test-results/screens/live-${name}.png`, fullPage: true });
}

const room = (id: string) => `/checkouts/${id}`;
const payer = (page: Page, spot: number) =>
  page.getByRole("region", { name: "Payers", exact: true }).getByRole("listitem").filter({ hasText: `Spot ${spot}` });

async function readDetails(page: Page) {
  const tab = page.locator("[data-surface='brand']");
  return {
    title: await page.getByRole("heading", { level: 1 }).textContent(),
    tab: await tab.textContent(),
    payers: await page.getByRole("region", { name: "Payers", exact: true }).textContent(),
  };
}

test("every fake room is a snapshot the contract allows", () => {
  for (const [id, snapshot] of Object.entries(ROOMS)) expect(parseRoomSnapshot(snapshot), id).not.toBeNull();
  const id = scriptedRoom();
  for (const [step, room] of SCRIPT.entries()) expect(parseRoomSnapshot(room(id)), `script step ${step}`).not.toBeNull();
});

test("a live room shows its seller, total, payers and every share to someone signed out", async ({ page }) => {
  const response = await page.goto(room(LIVE.open));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cabin groceries");
  await expect(page).toHaveTitle("Cabin groceries | OneTab");
  const tab = page.locator("[data-surface='brand']");
  await expect(tab).toContainText("30.00 test USDC");
  await expect(tab).toContainText(`Seller ${shortAddress(WALLETS.shop)}`);
  await expect(payer(page, 1)).toContainText(shortAddress(WALLETS.ava));
  await expect(payer(page, 1)).toContainText("Organizer");
  await expect(payer(page, 1)).toContainText("Joined");
  for (const spot of [1, 2, 3]) await expect(payer(page, spot)).toContainText("10.00 test USDC");
  for (const spot of [2, 3]) await expect(payer(page, spot)).toContainText("Open spot");
  await expect(page.locator("[data-status-line]")).toHaveText("Sign in with your wallet to take an open spot.");
  await expect(page.locator("[data-action='primary']")).toHaveText("Connect wallet");
  await expect(page.getByText("Sample data")).toHaveCount(0);
  await capture(page, "room-signed-out");
});

test("reloading a live room shows the same fixed details", async ({ page }) => {
  await page.goto(room(LIVE.open));
  const before = await readDetails(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cabin groceries");
  expect(await readDetails(page)).toEqual(before);
});

test("an uppercase checkout ID opens the same room, and its links use the lowercase ID", async ({ page }) => {
  const shouted = room(LIVE.open.toUpperCase());
  expect((await page.goto(shouted))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cabin groceries");
  expect((await page.goto(`${shouted}/result`))?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Back to checkout" })).toHaveAttribute("href", room(LIVE.open));
});

test("the server reads a live room once per page load", async ({ page, request }) => {
  const id = freshCountedRoom();
  await page.goto(room(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cabin groceries");
  const reads = await (await request.get(`${FAKE_API.rooms}/__reads/${id}`)).json();
  expect(reads).toEqual({ count: 1 });
});

test("the server reads from its configured origin, whatever Host the request names", async ({ request }) => {
  const response = await request.get(room(LIVE.open), {
    headers: { host: new URL(FAKE_API.empty).host, "x-forwarded-host": new URL(FAKE_API.empty).host },
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Cabin groceries");
});

test("the live result page reads the same room and links back to it with no query", async ({ page }) => {
  expect((await page.goto(`${room(LIVE.open)}/result`))?.status()).toBe(200);
  await expect(page).toHaveTitle("Cabin groceries payment | OneTab");
  await expect(page.getByRole("link", { name: "Back to checkout" })).toHaveAttribute("href", room(LIVE.open));
});

test("a full live room is readable by anyone with the link, and offers no Join", async ({ page }) => {
  expect((await page.goto(room(LIVE.full)))?.status()).toBe(200);
  await expect(page.locator("[data-situation]")).toHaveAttribute("data-situation", "full_not_ready");
  await expect(page.locator("[data-status-line]")).toHaveText(
    "Waiting for 1 payer to get ready. Sign in with your wallet if you hold a spot.",
  );
  await expect(page.getByRole("button", { name: "Join checkout" })).toHaveCount(0);
  await expect(payer(page, 2)).toContainText(shortAddress(WALLETS.cleo));
  await capture(page, "room-full");
});

test("a checkout the server doesn't know returns 404 and the not-found page", async ({ page }) => {
  expect((await page.goto(room(LIVE.missing)))?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We can't find this checkout.");
  await capture(page, "not-found");
});

for (const [name, id] of [
  ["an outage", LIVE.outage],
  ["a route that isn't deployed yet", LIVE.noRoute],
] as const) {
  test(`${name} shows the error page with Try again, never the not-found page`, async ({ page }) => {
    expect((await page.goto(room(id)))?.status()).toBe(500);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page didn't load");
    await expect(page).toHaveTitle("This page didn't load | OneTab");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the start" })).toHaveAttribute("href", "/");
    await expect(page.getByText("We can't find this checkout.")).toHaveCount(0);
    if (id === LIVE.outage) await capture(page, "outage");
  });
}

test("live create uses the server's configuration and asks to connect a wallet before creating", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Split a purchase");
  await page.getByLabel("Checkout name").fill("Cabin groceries");
  await page.getByLabel("Seller wallet").fill(WALLETS.shop);
  await page.getByLabel("Total in test USDC").fill("10");
  await page.getByLabel("3 payers").check();
  await page.getByRole("button", { name: "Review checkout" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check the details");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  const shares = page.getByRole("region", { name: "Each payer's share" });
  await expect(shares.getByText("3.333334 test USDC")).toHaveCount(1);
  await expect(shares.getByText("3.333333 test USDC")).toHaveCount(2);
  await expect(page.locator("[data-action='primary']")).toHaveText("Connect wallet");
  await expect(page.getByRole("button", { name: "Create checkout" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
  await capture(page, "create-review-signed-out");

  await page.locator("[data-action='primary']").click();
  await expect(page.locator("[data-wallet-line]")).toHaveText("Sign-in isn't available right now. Try again in a moment.");
  await expect(page.getByRole("button", { name: "Create checkout" })).toHaveCount(0);
});

const label = (page: Page) => page.locator("[data-status-label]");
const spotStatus = (page: Page, spot: number) => payer(page, spot).locator("[data-status]");
const roomReads = (page: Page, id: string) => page.waitForRequest((r) => new URL(r.url()).pathname === `/api/checkouts/${id}`);

test("three payers' screens agree on readiness and approvals at every step, and each moves to the result", async ({ page, browserApi, request }) => {
  test.setTimeout(60_000);
  const id = scriptedRoom();
  const pages = [page, await browserApi.newPage(), await browserApi.newPage()];
  for (const p of pages) await p.goto(room(id));
  const steps = [
    { label: SITUATIONS.full_not_ready.label, progress: "3 of 3 joined, 1 ready", spots: ["ready", "joined", "joined"] },
    { label: SITUATIONS.ready.label, progress: "3 of 3 joined, 3 ready", spots: ["ready", "ready", "ready"] },
    { label: SITUATIONS.preparing.label, progress: "0 of 3 approved", spots: ["ready", "ready", "ready"] },
    { label: SITUATIONS.signing.label, progress: "1 of 3 approved", spots: ["approved", "ready", "ready"] },
    { label: SITUATIONS.signing.label, progress: "2 of 3 approved", spots: ["approved", "approved", "ready"] },
  ];
  for (const [index, step] of steps.entries()) {
    if (index > 0) await request.post(nextStep(id));
    for (const p of pages) {
      await expect(label(p)).toHaveText(step.label);
      await expect(p.locator("[data-surface='brand']")).toContainText(step.progress);
      for (const [slot, status] of step.spots.entries()) await expect(spotStatus(p, slot + 1)).toHaveAttribute("data-status", status);
      await expect(p.getByRole("button", { name: "Start payment" })).toHaveCount(0);
      await expect(p.getByRole("button", { name: "Approve in wallet" })).toHaveCount(0);
    }
  }
  const approved = await spotStatus(page, 1).evaluate((el) => getComputedStyle(el).backgroundColor);
  const ready = await spotStatus(page, 3).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(approved, "Ready and Approved look different").not.toBe(ready);
  await capture(page, "room-two-approved");

  await request.post(nextStep(id));
  for (const p of pages) {
    await expect(p).toHaveURL(`${room(id)}/result`);
    await expect(label(p)).toHaveText(SITUATIONS.submitting.label);
  }
});

test("a page opened after the room moved on stays put, and Back after a move shows the current room without bouncing", async ({
  page,
  browserApi,
  request,
}) => {
  test.setTimeout(60_000);
  const id = scriptedRoom();
  for (let step = 0; step < 4; step++) await request.post(nextStep(id));
  const firstRead = roomReads(page, id);
  await page.goto(room(id));
  await (await firstRead).response();
  await expect(label(page)).toHaveText(SITUATIONS.signing.label);
  await request.post(nextStep(id));
  await expect(page).toHaveURL(`${room(id)}/result`);

  const later = await browserApi.newPage();
  await later.goto(room(id));
  await expect(later.locator("[data-situation]")).toHaveAttribute("data-situation", "submitting");
  await roomReads(later, id);
  await roomReads(later, id);
  await expect(later).toHaveURL(room(id));
  await expect(later.locator("[data-action='primary']")).toHaveText("View payment status");

  await page.goBack();
  await expect(page).toHaveURL(room(id));
  await expect(page.locator("[data-situation]")).toHaveAttribute("data-situation", "submitting");
  await roomReads(page, id);
  await expect(page).toHaveURL(room(id));
  await capture(page, "room-after-back");
});
