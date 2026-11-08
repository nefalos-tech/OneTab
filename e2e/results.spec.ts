import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { ACTIONS, SITUATIONS, STOP_REASONS, WORDS } from "../src/client/catalog";
import { parseRoomSnapshot } from "../src/client/contracts";
import { expect, test } from "./browser-api";
import { FAIL_SCRIPT, PAY_SCRIPT, REFERENCE, failBrowserReads, failingRoom, goToStep, holdServerReads, scriptedRoom } from "./fake-api.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function capture(page: Page, name: string) {
  await expect(panel(page), "the streamed room is revealed before it is checked and captured").toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.screenshot({ path: `test-results/screens/results-${name}.png`, fullPage: true });
}

const room = (id: string) => `/checkouts/${id}`;
const result = (id: string) => `/checkouts/${id}/result`;
const panel = (page: Page) => page.locator("[data-situation]");
const actions = (page: Page) => panel(page).locator("[data-action]");
const statusRegion = (page: Page) => page.locator("[data-status-block][role='status']");
const focusedStatus = (page: Page) => page.evaluate(() => document.activeElement?.hasAttribute("data-status-block") ?? false);
const browserReads = (page: Page, id: string) => page.waitForRequest((r) => new URL(r.url()).pathname === `/api/checkouts/${id}`);
const readAnswered = async (page: Page, id: string) => (await browserReads(page, id)).response();

function countReads(page: Page, id: string): { readonly count: () => number } {
  let reads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === `/api/checkouts/${id}`) reads += 1;
  });
  return { count: () => reads };
}

function scripted<Script extends object>(id: string) {
  return {
    id,
    goTo: async (request: APIRequestContext, step: keyof Script & string) => {
      const answer = await request.post(goToStep(id, step));
      expect(answer.ok(), `step ${step} of ${id}: ${await answer.text()}`).toBe(true);
    },
  };
}
const payingRoom = () => scripted<typeof PAY_SCRIPT>(scriptedRoom());
const failedRoom = () => scripted<typeof FAIL_SCRIPT>(failingRoom());
const readsFail = (request: APIRequestContext, id: string, on: boolean) => request.post(failBrowserReads(id, on));
const serverReadsHeld = (request: APIRequestContext, id: string, on: boolean) => request.post(holdServerReads(id, on));
const wakeOnline = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

/** Holds the first room read sent from the page at `path` until released, so the room can change before it answers. */
async function holdFirstRead(page: Page, id: string, path: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let holding!: () => void;
  const held = new Promise<void>((resolve) => (holding = resolve));
  let waiting = true;
  await page.route(`**/api/checkouts/${id}`, async (route) => {
    const from = await route.request().headerValue("referer");
    if (waiting && from !== null && new URL(from).pathname === path) {
      waiting = false;
      holding();
      await released;
    }
    await route.fallback();
  });
  return { held, release };
}

async function attemptShown(page: Page): Promise<string | null> {
  await expect(panel(page)).toBeVisible();
  return panel(page).getAttribute("data-attempt");
}

test("every failing-room step is a snapshot the contract allows", () => {
  const id = failingRoom();
  for (const [step, snapshot] of Object.entries(FAIL_SCRIPT)) expect(parseRoomSnapshot(snapshot(id)), `fail step ${step}`).not.toBeNull();
});

test("a transaction reference alone is never a receipt, and the receipt stops the polling", async ({ page, request }) => {
  test.setTimeout(60_000);
  const { id, goTo } = payingRoom();
  await goTo(request, "unresolved");
  await page.goto(result(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "unresolved");
  await expect(panel(page)).toContainText(REFERENCE);
  await expect(page.getByRole("heading", { name: WORDS.receipt })).toHaveCount(0);
  await expect(page.getByRole("link", { name: ACTIONS.view_on_explorer.label })).toHaveCount(0);
  await expect(actions(page)).toHaveText([ACTIONS.connect_wallet.label, ACTIONS.back_to_checkout.label]);
  await capture(page, "unresolved-signed-out");

  const reads = countReads(page, id);
  await goTo(request, "paid");
  await expect(panel(page)).toHaveAttribute("data-situation", "paid");
  await expect(page.getByRole("heading", { name: WORDS.receipt })).toBeVisible();
  await expect(page.getByRole("link", { name: ACTIONS.view_on_explorer.label })).toHaveAttribute(
    "href",
    `https://explorer.solana.com/tx/${REFERENCE}?cluster=devnet`,
  );
  await capture(page, "paid");
  const afterReceipt = reads.count();
  await page.waitForTimeout(6_000);
  expect(reads.count(), "no room reads once the receipt shows").toBe(afterReceipt);
});

for (const [name, step, screen] of [
  ["approvals are open, on the checkout page", "one_approved", "room"],
  ["approvals are open, on the result page", "one_approved", "result"],
  ["the payment is sending", "sent", "result"],
  ["the result is unknown", "unresolved", "result"],
] as const) {
  test(`reloading while ${name} shows the same attempt`, async ({ page, request }) => {
    const { id, goTo } = payingRoom();
    await goTo(request, step);
    await page.goto(screen === "room" ? room(id) : result(id));
    const before = await attemptShown(page);
    expect(before).toMatch(/^a7/);
    await page.reload();
    expect(await attemptShown(page)).toBe(before);
    if (step === "one_approved" && screen === "result") {
      await expect(panel(page)).toContainText(WORDS.approvals_open);
      await expect(panel(page)).not.toContainText(WORDS.no_payment_yet);
    }
  });
}

test("losing the connection keeps the same transaction on screen and says so until it's back", async ({ page, request }) => {
  test.setTimeout(90_000);
  const { id, goTo } = payingRoom();
  await goTo(request, "unresolved");
  await page.goto(result(id));
  const attempt = await attemptShown(page);
  const line = await page.locator("[data-status-line]").textContent();
  await expect(page.locator("[data-connection]")).toHaveCount(0);
  expect(await focusedStatus(page), "a direct load leaves focus where the browser puts it").toBe(false);

  await readsFail(request, id, true);
  await expect(statusRegion(page).locator("[data-connection]")).toHaveText(WORDS.room_unreachable, { timeout: 5_000 });
  await expect(page.locator("[data-status-label]")).toHaveText(SITUATIONS.unresolved.label);
  await expect(page.locator("[data-status-line]")).toHaveText(line!);
  await expect(panel(page)).toContainText(REFERENCE);
  await expect(page).toHaveURL(result(id));
  await capture(page, "unresolved-offline");

  await page.reload();
  expect(await attemptShown(page), "the server still renders the attempt during the outage").toBe(attempt);
  await expect(page.locator("[data-connection]")).toHaveText(WORDS.room_unreachable, { timeout: 5_000 });

  await readsFail(request, id, false);
  await wakeOnline(page);
  await expect(page.locator("[data-connection]"), "online reads at once, well inside the back-off").toHaveCount(0, { timeout: 2_000 });
  await goTo(request, "paid");
  await expect(panel(page)).toHaveAttribute("data-situation", "paid");
  await expect(page.getByRole("heading", { name: WORDS.receipt })).toBeVisible();
});

test("an unresolved payment offers nothing that starts another, on either screen", async ({ page, request }) => {
  const { id, goTo } = payingRoom();
  await goTo(request, "unresolved");
  for (const path of [room(id), result(id)]) {
    await page.goto(path);
    await expect(panel(page)).toHaveAttribute("data-situation", "unresolved");
    for (const label of [ACTIONS.start_payment.label, ACTIONS.retry.label]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
  }
});

test("sending, unresolved and sending again never show Try again, a receipt or the server's message", async ({ page, request }) => {
  test.setTimeout(60_000);
  const { id, goTo } = payingRoom();
  await goTo(request, "sent");
  await page.goto(result(id));
  for (const [step, situation] of [
    ["sent", "submitting"],
    ["unresolved", "unresolved"],
    ["sent_again", "submitting"],
  ] as const) {
    await goTo(request, step);
    await expect(panel(page)).toHaveAttribute("data-situation", situation);
    await expect(panel(page)).toHaveAttribute("data-attempt", /^a7/);
    await expect(page.getByRole("button", { name: ACTIONS.retry.label })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: WORDS.receipt })).toHaveCount(0);
    await expect(page.getByText("Payment attempt did not complete.")).toHaveCount(0);
  }
});

test("a payment that fails before sending moves viewers to an honest result, and its replacement moves them back", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { id, goTo } = failedRoom();
  const firstRead = readAnswered(page, id);
  await page.goto(room(id));
  await firstRead;
  await expect(panel(page)).toHaveAttribute("data-situation", "ready");

  await goTo(request, "preparing");
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  await expect(page).toHaveURL(room(id));
  const failed = await attemptShown(page);

  await goTo(request, "failed");
  await expect(page).toHaveURL(result(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "failed");
  await expect(panel(page)).toHaveAttribute("data-attempt", failed!);
  await expect.poll(() => focusedStatus(page), "the move puts focus on the status, so it is read first").toBe(true);
  const reason = statusRegion(page).locator("[data-status-reason]");
  await expect(reason).toHaveAttribute("data-reason-from", "attempt");
  await expect(reason).toHaveText(`${STOP_REASONS.not_sent.happened}${STOP_REASONS.not_sent.next}`);
  await expect(page.locator("[data-status-line]")).toHaveText(`${WORDS.failed_waiting} ${WORDS.sign_in}`);
  await expect(page.getByRole("button", { name: ACTIONS.retry.label })).toHaveCount(0);
  await expect(page.getByText("Payment attempt did not complete.")).toHaveCount(0);
  await capture(page, "failed-not-sent-signed-out");
  await readAnswered(page, id);

  await goTo(request, "replaced");
  await expect(page).toHaveURL(room(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  await expect(page.locator("[data-surface='brand']")).toContainText("0 of 3 approved");
  const replacement = await attemptShown(page);
  expect(replacement).toMatch(/^b7/);
  expect(replacement).not.toBe(failed);
});

test("a viewer moved to the result is moved back when the room changes owner again before the result's first read answers", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { id, goTo } = failedRoom();
  await goTo(request, "preparing");
  const firstRead = readAnswered(page, id);
  await page.goto(room(id));
  await firstRead;
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");

  const resultRead = await holdFirstRead(page, id, result(id));
  await goTo(request, "failed");
  await expect(page).toHaveURL(result(id));
  await resultRead.held;
  await goTo(request, "replaced");
  resultRead.release();
  await expect(page).toHaveURL(room(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  expect(await attemptShown(page)).toMatch(/^b7/);
});

test("a viewer who leaves while a move's page loads, then goes Back to it, is neither moved nor focused there", async ({ page, request }) => {
  test.setTimeout(60_000);
  const { id, goTo } = failedRoom();
  await goTo(request, "preparing");
  const firstRead = readAnswered(page, id);
  await page.goto(room(id));
  await firstRead;
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");

  await serverReadsHeld(request, id, true);
  await goTo(request, "failed");
  await expect(page).toHaveURL(result(id));
  await expect(page.locator("main[aria-busy='true']"), "the result is still loading").toBeVisible();
  await page.locator("header").getByRole("link", { name: WORDS.product }).click();
  await expect(page).toHaveURL("/");
  await serverReadsHeld(request, id, false);
  await goTo(request, "replaced");

  const backRead = readAnswered(page, id);
  await page.goBack();
  await expect(page).toHaveURL(result(id));
  await backRead;
  await readAnswered(page, id);
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  await expect(page, "a page restored by Back stays where it was").toHaveURL(result(id));
  expect(await focusedStatus(page), "only a move's own page focuses its status").toBe(false);
});

test("a viewer who reloads the result during an outage is moved to the room once the replacement can be read", async ({ page, request }) => {
  test.setTimeout(60_000);
  const { id, goTo } = failedRoom();
  await goTo(request, "failed");
  await page.goto(result(id));
  const failed = await attemptShown(page);
  await readsFail(request, id, true);
  await page.reload();
  expect(await attemptShown(page)).toBe(failed);
  await expect(page.locator("[data-connection]")).toHaveText(WORDS.room_unreachable, { timeout: 5_000 });

  await goTo(request, "replaced");
  await readsFail(request, id, false);
  await wakeOnline(page);
  await expect(page).toHaveURL(room(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  expect(await attemptShown(page)).toMatch(/^b7/);
});

test("the checkout page says when OneTab can't be reached while approvals are open, and keeps the same attempt", async ({ page, request }) => {
  test.setTimeout(60_000);
  const { id, goTo } = payingRoom();
  await goTo(request, "one_approved");
  await page.goto(room(id));
  const attempt = await attemptShown(page);
  await readsFail(request, id, true);
  await expect(statusRegion(page).locator("[data-connection]")).toHaveText(WORDS.room_unreachable, { timeout: 5_000 });
  await expect(panel(page)).toHaveAttribute("data-situation", "signing");
  await expect(panel(page)).toHaveAttribute("data-attempt", attempt!);
  await capture(page, "room-offline");

  await readsFail(request, id, false);
  await wakeOnline(page);
  await expect(page.locator("[data-connection]")).toHaveCount(0, { timeout: 2_000 });
  await expect(panel(page)).toHaveAttribute("data-attempt", attempt!);
});
