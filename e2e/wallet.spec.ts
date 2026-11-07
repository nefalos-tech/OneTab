import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { SAMPLE_WALLETS } from "../src/client/fixture-data";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

const CONNECT_LINE = "Approve the connection in your wallet.";
const SIGN_LINE = "Sign the sign-in message in your wallet. Signing in proves the wallet is yours. It can't move money.";
const OUTSIDER = "SAMP…Gst4";
const ORGANIZER = "SAMP…org1";
const BEA = "SAMP…Bea2";
const CAM = "SAMP…Cam3";
const switchedTo = (short: string) => `Your wallet switched to ${short}. Sign in again to continue as that wallet.`;

/** Every flow here runs on sample data or on a live page before P1 and B2, so none may call an API route. */
const test = base.extend<{ apiCalls: string[] }>({
  apiCalls: [
    async ({ page }, use) => {
      const calls: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(`${request.method()} ${request.url()}`);
      });
      await use(calls);
      expect(calls, "a wallet flow called a real route").toEqual([]);
    },
    { auto: true },
  ],
});

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function capture(page: Page, name: string) {
  await expectNoAxeViolations(page);
  await page.screenshot({ path: `test-results/screens/wallet-${name}.png`, fullPage: true });
}

function wallet(page: Page) {
  const header = page.getByRole("banner");
  const panel = page.getByRole("complementary", { name: "Sample wallet" });
  return {
    control: header.locator("#wallet-control"),
    connect: header.getByRole("button", { name: "Connect wallet" }),
    signedInAs: (short: string) => header.getByRole("button", { name: `Signed in as ${short}`, exact: true }),
    line: page.locator("[data-wallet-line]"),
    action: page.locator("#wallet-status-action"),
    panel,
    request: panel.locator("[data-sample-prompt]"),
    approve: panel.getByRole("button", { name: "Approve", exact: true }),
    reject: panel.getByRole("button", { name: "Reject", exact: true }),
    account: (label: string) => panel.getByRole("radio", { name: new RegExp(`^${label} `) }),
  };
}

const roomLine = (page: Page) => page.locator("[data-status-line]");
const roomPrimary = (page: Page) => page.locator("[data-action='primary']");
const payerRow = (page: Page, spot: number) =>
  page.getByRole("region", { name: "Payers" }).getByRole("listitem").filter({ hasText: `Spot ${spot}` });

async function signInFromSignedOut(page: Page, start: () => Promise<void>) {
  const w = wallet(page);
  await start();
  await expect(w.line).toHaveText(CONNECT_LINE);
  await expect(w.request).toHaveText("OneTab wants to see your wallet address.");
  await w.approve.click();
  await expect(w.line).toHaveText(SIGN_LINE);
  await w.approve.click();
}

test("Connect wallet in the header runs both prompts and signs in as the selected account", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=signed-out");
  await expect(roomPrimary(page)).toHaveText("Connect wallet");

  await w.connect.click();
  await expect(w.control).toHaveText("Connecting…");
  await expect(w.line).toHaveText(CONNECT_LINE);
  await expect(w.action).toHaveText("Cancel");
  await expect(w.request).toHaveText("OneTab wants to see your wallet address.");
  await capture(page, "connect-prompt");

  await w.approve.click();
  await expect(w.control).toHaveText("Signing in…");
  await expect(w.line).toHaveText(SIGN_LINE);
  await expect(w.request).toHaveText("OneTab asks you to sign this message:");
  await expect(w.panel).toContainText("Signing in can't move money.");
  await capture(page, "sign-prompt");

  await w.approve.click();
  await expect(w.signedInAs(OUTSIDER)).toBeVisible();
  await expect(w.line).toHaveText(`Signed in as ${OUTSIDER}.`);
  await expect(w.action).toHaveCount(0);
  await expect(roomPrimary(page)).toHaveText("Join checkout");
  await expect(roomLine(page)).toHaveText("There's an open spot. Join to pay your share.");
  await capture(page, "signed-in");
});

test("the room's own Connect wallet runs the same two prompts", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=signed-out");
  await signInFromSignedOut(page, () => roomPrimary(page).click());
  await expect(w.signedInAs(OUTSIDER)).toBeVisible();
  await expect(roomPrimary(page)).toHaveText("Join checkout");
});

test("refusing the connection shares nothing and offers Connect wallet", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=signed-out");
  await w.connect.click();
  await w.reject.click();
  await expect(w.line).toHaveText("You closed the connection request. Nothing was shared.");
  await expect(w.action).toHaveText("Connect wallet");
  await expect(w.connect).toBeVisible();
  await expect(roomPrimary(page)).toHaveText("Connect wallet");
  await capture(page, "connect-refused");
});

test("refusing to sign in moves nothing, and Sign in again opens only the sign prompt", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=signed-out");
  await w.connect.click();
  await w.approve.click();
  await expect(w.line).toHaveText(SIGN_LINE);
  await w.reject.click();
  await expect(w.line).toHaveText("You didn't sign in. Nothing was signed or sent.");
  await expect(w.action).toHaveText("Sign in again");
  await expect(roomPrimary(page)).toHaveText("Connect wallet");
  await capture(page, "sign-refused");

  await w.action.click();
  await expect(w.request).toHaveAttribute("data-sample-prompt", "sign");
  await expect(w.line).toHaveText(SIGN_LINE);
  await w.approve.click();
  await expect(w.signedInAs(OUTSIDER)).toBeVisible();
});

test("an approval that arrives after Cancel is ignored", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=signed-out");
  await w.connect.click();
  await expect(w.line).toHaveText(CONNECT_LINE);
  await w.action.click();
  await expect(w.line).toHaveText("");
  await expect(w.connect).toBeVisible();

  await expect(w.request).toHaveAttribute("data-sample-prompt", "connect");
  await w.approve.click();
  await expect(w.request).toHaveText("No requests.");
  await expect(w.connect).toBeVisible();
  await expect(w.line).toHaveText("");
  await expect(roomPrimary(page)).toHaveText("Connect wallet");
});

test("switching accounts drops the old payer's share, Ready and Approve before anything else", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-full-not-ready?as=spot-2");
  await expect(w.signedInAs(BEA)).toBeVisible();
  await expect(roomLine(page)).toHaveText("You're ready. Waiting for 1 more payer to get ready.");
  await expect(page.getByRole("button", { name: "Not ready yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your share" })).toBeVisible();

  await w.account("Cam").check();
  await expect(w.line).toHaveText(switchedTo(CAM));
  await expect(w.action).toHaveText("Sign in again");
  await expect(w.control).toHaveAccessibleName(`Wallet ${CAM}`);
  await expect(page.getByRole("button", { name: "Not ready yet" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your share" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Payers" }).getByText("You", { exact: true })).toHaveCount(0);
  await expect(roomLine(page)).toHaveText("Waiting for 1 payer to get ready. Connect your wallet if you hold a spot.");
  await expect(w.request).toHaveText("No requests.");
  await capture(page, "account-switched");

  await w.action.click();
  await expect(w.request).toHaveAttribute("data-sample-prompt", "sign");
  await w.approve.click();
  await expect(w.signedInAs(CAM)).toBeVisible();
  await expect(roomLine(page)).toHaveText("Everyone has joined. Check your share, then tell the group you're ready.");
  await expect(roomPrimary(page)).toHaveText("I'm ready");
  await expect(payerRow(page, 3).getByText("You", { exact: true })).toBeVisible();
});

test("switching accounts while approvals are open removes Approve in wallet", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-signing?as=spot-2");
  await expect(page.getByRole("button", { name: "Approve in wallet" })).toBeVisible();
  await w.account("Organizer").check();
  await expect(page.getByRole("button", { name: "Approve in wallet" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your share" })).toHaveCount(0);
  await expect(w.line).toHaveText(switchedTo(ORGANIZER));
});

test("a switch during the sign prompt, then a late Approve, signs nobody in", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=signed-out");
  await w.connect.click();
  await w.approve.click();
  await expect(w.line).toHaveText(SIGN_LINE);

  await w.account("Bea").check();
  await expect(w.line).toHaveText(switchedTo(BEA));
  await expect(w.request).toHaveAttribute("data-sample-prompt", "sign");
  await w.approve.click();
  await expect(w.request).toHaveText("No requests.");
  await expect(w.line).toHaveText(switchedTo(BEA));
  await expect(w.control).toHaveAccessibleName(`Wallet ${BEA}`);
  await expect(roomPrimary(page)).toHaveText("Connect wallet");
});

test("Disconnect signs out at once and gives focus back to Connect wallet", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = wallet(page);
  await page.goto("/checkouts/sample-signing?as=spot-2");
  await w.signedInAs(BEA).click();
  await expect(w.control).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Copy address" }).click();
  await expect(page.getByRole("banner").getByRole("status")).toHaveText("Copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SAMPLE_WALLETS.bea);
  await capture(page, "menu");

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(w.connect).toBeFocused();
  await expect(page.getByRole("button", { name: "Approve in wallet" })).toHaveCount(0);
  await expect(roomPrimary(page)).toHaveText("Connect wallet");
  await expect(w.line).toHaveText("");
});

test("an ended sign-in asks the same wallet to sign in again without a connection prompt", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=spot-2");
  await w.panel.getByRole("button", { name: "End sign-in" }).click();
  await expect(w.line).toHaveText("Your sign-in expired. Sign in again with the same wallet to continue.");
  await expect(w.action).toBeFocused();
  await expect(w.action).toHaveText("Sign in again");
  await expect(page.getByRole("heading", { name: "Your share" })).toHaveCount(0);
  await capture(page, "session-expired");

  await w.action.click();
  await expect(w.request).toHaveAttribute("data-sample-prompt", "sign");
  await w.approve.click();
  await expect(w.signedInAs(BEA)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your share" })).toBeVisible();
});

test("on the create screen, the organizer follows the wallet's signed-in account", async ({ page }) => {
  const w = wallet(page);
  const seller = page.getByLabel("Seller wallet");
  const ownWallet = page.getByText("The seller can't be your own wallet. Enter the seller's wallet.");
  await page.goto("/?sample");
  await expect(w.signedInAs(ORGANIZER)).toBeVisible();
  await seller.fill(SAMPLE_WALLETS.organizer);
  await seller.blur();
  await expect(ownWallet).toBeVisible();

  await w.account("Bea").check();
  await expect(ownWallet).toHaveCount(0);
  await w.action.click();
  await w.approve.click();
  await expect(w.signedInAs(BEA)).toBeVisible();
  await expect(ownWallet).toHaveCount(0);
  await seller.fill(SAMPLE_WALLETS.bea);
  await expect(ownWallet).toBeVisible();
  await capture(page, "create-as-bea");
});

test("a live page has no sample wallet, and Connect wallet says sign-in isn't available yet", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/");
  await expect(w.panel).toHaveCount(0);
  await w.connect.click();
  await expect(w.line).toHaveText("Sign-in isn't available right now. Try again in a moment.");
  await expect(w.action).toHaveText("Try again");
  await expect(w.connect).toBeVisible();
  await capture(page, "live-unavailable");
});

async function moveFocus(page: Page, target: Locator, key: "Tab" | "Shift+Tab" = "Tab") {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`${key} never reached the target`);
}

test("every wallet control works by keyboard alone and keeps focus somewhere sensible", async ({ page }) => {
  const w = wallet(page);
  await page.goto("/checkouts/sample-open-spots?as=signed-out");

  await moveFocus(page, w.connect);
  await page.keyboard.press("Enter");
  await expect(w.line).toHaveText(CONNECT_LINE);
  await expect(w.control).toBeFocused();

  await moveFocus(page, w.action);
  await expect(w.action).toHaveText("Cancel");
  await page.keyboard.press("Enter");
  await expect(w.connect).toBeFocused();
  await expect(w.line).toHaveText("");

  await page.keyboard.press("Space");
  await moveFocus(page, w.reject);
  await page.keyboard.press("Enter");
  await expect(w.line).toHaveText("You closed the connection request. Nothing was shared.");
  await expect(w.reject).toBeFocused();

  await moveFocus(page, w.action, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(w.action).toHaveText("Cancel");
  await expect(w.action).toBeFocused();
  await moveFocus(page, w.approve);
  await page.keyboard.press("Enter");
  await expect(w.line).toHaveText(SIGN_LINE);
  await expect(w.approve).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(w.signedInAs(OUTSIDER)).toBeVisible();
  await expect(w.approve).toBeFocused();

  await moveFocus(page, w.control, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(w.control).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Copy address" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(w.control).toHaveAttribute("aria-expanded", "false");
  await expect(w.control).toBeFocused();

  await page.keyboard.press("Enter");
  await moveFocus(page, page.getByRole("button", { name: "Disconnect" }));
  await page.keyboard.press("Enter");
  await expect(w.connect).toBeFocused();
  await expect(roomPrimary(page)).toHaveText("Connect wallet");
});
