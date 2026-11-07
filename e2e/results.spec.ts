import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ACTIONS, SITUATIONS, STOP_REASONS, WORDS } from "../src/client/catalog";
import { parseRoomSnapshot } from "../src/client/contracts";
import { expect, test } from "./browser-api";
import { FAIL_SCRIPT, REFERENCE, failingRoom, nextStep, outage, scriptedRoom } from "./fake-api.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const SENT = 6;
const UNRESOLVED = 7;
const SENT_AGAIN = 8;
const PAID = 9;
const SIGNING = 3;

async function capture(page: Page, name: string) {
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

function countReads(page: Page, id: string): { readonly count: () => number } {
  let reads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === `/api/checkouts/${id}`) reads += 1;
  });
  return { count: () => reads };
}

async function stepTo(request: { post(url: string): Promise<unknown> }, id: string, step: number) {
  for (let i = 0; i < step; i++) await request.post(nextStep(id));
}

async function attemptShown(page: Page): Promise<string | null> {
  await expect(panel(page)).toBeVisible();
  return panel(page).getAttribute("data-attempt");
}

test("every failing-room step is a snapshot the contract allows", () => {
  const id = failingRoom();
  for (const [step, snapshot] of FAIL_SCRIPT.entries()) expect(parseRoomSnapshot(snapshot(id)), `fail step ${step}`).not.toBeNull();
});

test("a transaction reference alone is never a receipt, and the receipt stops the polling", async ({ page, request }) => {
  test.setTimeout(60_000);
  const id = scriptedRoom();
  await stepTo(request, id, UNRESOLVED);
  await page.goto(result(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "unresolved");
  await expect(panel(page)).toContainText(REFERENCE);
  await expect(page.getByRole("heading", { name: WORDS.receipt })).toHaveCount(0);
  await expect(page.getByRole("link", { name: ACTIONS.view_on_explorer.label })).toHaveCount(0);
  await expect(actions(page)).toHaveText([ACTIONS.connect_wallet.label, ACTIONS.back_to_checkout.label]);
  await capture(page, "unresolved-signed-out");

  const reads = countReads(page, id);
  await stepTo(request, id, PAID - UNRESOLVED);
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
  ["approvals are open, on the checkout page", SIGNING, "room"],
  ["approvals are open, on the result page", SIGNING, "result"],
  ["the payment is sending", SENT, "result"],
  ["the result is unknown", UNRESOLVED, "result"],
] as const) {
  test(`reloading while ${name} shows the same attempt`, async ({ page, request }) => {
    const id = scriptedRoom();
    await stepTo(request, id, step);
    await page.goto(screen === "room" ? room(id) : result(id));
    const before = await attemptShown(page);
    expect(before).toMatch(/^a7/);
    await page.reload();
    expect(await attemptShown(page)).toBe(before);
    if (step === SIGNING && screen === "result") {
      await expect(panel(page)).toContainText(WORDS.approvals_open);
      await expect(panel(page)).not.toContainText(WORDS.no_payment_yet);
    }
  });
}

test("losing the connection keeps the same transaction on screen and says so until it's back", async ({ page, request }) => {
  test.setTimeout(90_000);
  const id = scriptedRoom();
  await stepTo(request, id, UNRESOLVED);
  await page.goto(result(id));
  const attempt = await attemptShown(page);
  const line = await page.locator("[data-status-line]").textContent();
  await expect(page.locator("[data-connection]")).toHaveCount(0);
  expect(await focusedStatus(page), "a direct load leaves focus where the browser puts it").toBe(false);

  await request.post(outage(id, true));
  await expect(statusRegion(page).locator("[data-connection]")).toHaveText(WORDS.room_unreachable, { timeout: 5_000 });
  await expect(page.locator("[data-status-label]")).toHaveText(SITUATIONS.unresolved.label);
  await expect(page.locator("[data-status-line]")).toHaveText(line!);
  await expect(panel(page)).toContainText(REFERENCE);
  await expect(page).toHaveURL(result(id));
  await capture(page, "unresolved-offline");

  await page.reload();
  expect(await attemptShown(page), "the server still renders the attempt during the outage").toBe(attempt);
  await expect(page.locator("[data-connection]")).toHaveText(WORDS.room_unreachable, { timeout: 5_000 });

  await request.post(outage(id, false));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("[data-connection]")).toHaveCount(0);
  await stepTo(request, id, PAID - UNRESOLVED);
  await expect(panel(page)).toHaveAttribute("data-situation", "paid");
  await expect(page.getByRole("heading", { name: WORDS.receipt })).toBeVisible();
});

test("an unresolved payment offers nothing that starts another, on either screen", async ({ page, request }) => {
  const id = scriptedRoom();
  await stepTo(request, id, UNRESOLVED);
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
  const id = scriptedRoom();
  await stepTo(request, id, SENT);
  await page.goto(result(id));
  for (const [step, situation] of [
    [SENT, "submitting"],
    [UNRESOLVED, "unresolved"],
    [SENT_AGAIN, "submitting"],
  ] as const) {
    if (step > SENT) await request.post(nextStep(id));
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
  const id = failingRoom();
  const firstRead = browserReads(page, id);
  await page.goto(room(id));
  await (await firstRead).response();
  await expect(panel(page)).toHaveAttribute("data-situation", "ready");

  await request.post(nextStep(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  await expect(page).toHaveURL(room(id));
  const failed = await attemptShown(page);

  await request.post(nextStep(id));
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
  await (await browserReads(page, id)).response();
  await browserReads(page, id);

  await request.post(nextStep(id));
  await expect(page).toHaveURL(room(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  await expect(page.locator("[data-surface='brand']")).toContainText("0 of 3 approved");
  const replacement = await attemptShown(page);
  expect(replacement).toMatch(/^b7/);
  expect(replacement).not.toBe(failed);
});

test("a viewer who reloads the result during an outage is moved to the room once the replacement can be read", async ({ page, request }) => {
  test.setTimeout(60_000);
  const id = failingRoom();
  await stepTo(request, id, 2);
  await page.goto(result(id));
  const failed = await attemptShown(page);
  await request.post(outage(id, true));
  await page.reload();
  expect(await attemptShown(page)).toBe(failed);
  await expect(page.locator("[data-connection]")).toHaveText(WORDS.room_unreachable, { timeout: 5_000 });

  await request.post(nextStep(id));
  await request.post(outage(id, false));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page).toHaveURL(room(id));
  await expect(panel(page)).toHaveAttribute("data-situation", "preparing");
  expect(await attemptShown(page)).toMatch(/^b7/);
});
