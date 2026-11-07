import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";
import { shortAddress } from "../src/client/checkout-view";
import { parseRoomSnapshot } from "../src/client/contracts";
import { FAKE_API, LIVE, ROOMS, WALLETS } from "./fake-api.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

const test = base.extend<{ failOnAnyApiCall: string[] }>({
  failOnAnyApiCall: [
    async ({ page }, use) => {
      const calls: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(`${request.method()} ${request.url()}`);
      });
      await use(calls);
      expect(calls, "a live page called an API route from the browser").toEqual([]);
    },
    { auto: true },
  ],
});

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

test("the server reads a live room once per page load", async ({ page, request }) => {
  await page.goto(room(LIVE.counted));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cabin groceries");
  const reads = await (await request.get(`${FAKE_API.rooms}/__reads/${LIVE.counted}`)).json();
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
