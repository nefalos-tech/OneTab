import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { ACTIONS, REQUEST_PROBLEMS, WALLET_PROBLEMS } from "../src/client/catalog";
import { shortAddress } from "../src/client/checkout-view";
import type { KeyedPayer } from "../src/client/test-support/keyed-payment";
import { expect, test, type BrowserApi } from "./browser-api";
import { installFakeWallet, type FakeWallet } from "./fake-wallet";
import { liveBackend, type LiveBackend } from "./live-backend";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function capture(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await page.screenshot({ path: `test-results/screens/live-wallet-${name}.png`, fullPage: true });
}

const header = (page: Page) => page.getByRole("banner");
const signedInAs = (page: Page, payer: KeyedPayer) =>
  header(page).getByRole("button", { name: `Signed in as ${shortAddress(payer.address)}`, exact: true });
const walletLine = (page: Page) => page.locator("[data-wallet-line]");
const approve = (page: Page) => page.getByRole("button", { name: ACTIONS.approve.label, exact: true });
const approving = (page: Page) => page.getByRole("button", { name: ACTIONS.approve.busy, exact: true });
const prompts = (wallet: FakeWallet) => wallet.seen.map((s) => `${s.wallet} ${s.prompt}`);

type World = { readonly page: Page; readonly backend: LiveBackend; readonly wallet: FakeWallet; readonly payer: KeyedPayer };
type RoomOptions = { readonly accounts?: 1 | 2; readonly decoyFirst?: boolean };
type Fixtures = { readonly page: Page; readonly browserApi: BrowserApi; readonly request: APIRequestContext; readonly baseURL?: string };

/** A fresh signing room whose payers have real keys, and a page with a fake wallet holding payer 1's key. */
const live = test.extend<{ openRoom: (options?: RoomOptions) => Promise<World> }>({
  openRoom: async ({ page, browserApi, request, baseURL }, provide) => {
    await provide((options = {}) => openRoom({ page, browserApi, request, baseURL }, options));
  },
});

async function openRoom({ page, browserApi, request, baseURL }: Fixtures, options: RoomOptions): Promise<World> {
  const backend = await liveBackend(request, baseURL!);
  const [, payer, other] = backend.payment.payers;
  const wallet = await installFakeWallet(page.context(), options.accounts === 2 ? [payer!, other!] : [payer!], { decoyFirst: options.decoyFirst });
  browserApi.answer(page.context(), backend.server());
  await page.goto(`/checkouts/${backend.roomId}`);
  await expect(page.getByRole("heading", { level: 1 }), "the streamed room is revealed before anyone acts").toHaveText("Weekend cabin");
  return { page, backend, wallet, payer: payer! };
}

async function signIn({ page, payer }: World) {
  await header(page).getByRole("button", { name: ACTIONS.connect_wallet.label }).click();
  await expect(signedInAs(page, payer)).toBeVisible();
}

live("a live room with a wallet installed loads with no error before the first click", async ({ page, openRoom }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const { wallet } = await openRoom();
  await expect(header(page).getByRole("button", { name: ACTIONS.connect_wallet.label })).toBeVisible();
  expect(errors).toEqual([]);
  expect(wallet.seen, "no wallet call before the first click").toEqual([]);
});

live("Connect wallet asks the wallet to connect, signs exactly the server's challenge and signs in", async ({ openRoom }) => {
  const world = await openRoom();
  await signIn(world);
  const { wallet, backend } = world;
  expect(prompts(wallet)).toEqual(["Phantom connect", "Phantom signMessage"]);
  expect(wallet.seen[1]!.bytes).toEqual(backend.issued[0]);
  expect(backend.verifies).toHaveLength(1);
  expect(backend.verifies[0]).toMatch(/^[A-Za-z0-9+/]{86}==$/);
});

live("refusing the sign-in message shows its words, and nothing is sent to verify", async ({ openRoom }) => {
  const { page, wallet, backend } = await openRoom();
  wallet.rejectNext("signMessage");
  await header(page).getByRole("button", { name: ACTIONS.connect_wallet.label }).click();
  await expect(walletLine(page)).toHaveText(WALLET_PROBLEMS.sign_rejected.message);
  expect(prompts(wallet)).toEqual(["Phantom connect", "Phantom signMessage"]);
  expect(backend.verifies).toEqual([]);
});

live("switching account in the wallet after sign-in asks to sign in again as that account", async ({ openRoom }) => {
  const world = await openRoom({ accounts: 2 });
  await signIn(world);
  const other = world.backend.payment.payers[2]!;
  await world.wallet.switchTo(world.page, 1);
  await expect(walletLine(world.page)).toHaveText(WALLET_PROBLEMS.account_switched.message.replace("{address}", shortAddress(other.address)));
  await expect(signedInAs(world.page, world.payer)).toHaveCount(0);
});

live("with another capable wallet registered first, Connect wallet still uses Phantom", async ({ openRoom }) => {
  const world = await openRoom({ decoyFirst: true });
  await signIn(world);
  expect(prompts(world.wallet)).toEqual(["Phantom connect", "Phantom signMessage"]);
});

live("Approve opens one sign-only prompt with the payload's bytes and uploads exactly the messageHash and signature", async ({ openRoom }) => {
  const world = await openRoom();
  await signIn(world);
  const { page, wallet, backend, payer } = world;
  await approve(page).click();
  await expect.poll(() => backend.uploads.length).toBe(1);
  await expect(approving(page)).toHaveCount(0);
  await expect(approve(page), "the payer's own approval took Approve away").toHaveCount(0);
  expect(prompts(wallet)).toEqual(["Phantom connect", "Phantom signMessage", "Phantom signTransaction"]);
  expect(wallet.seen[2]!.bytes).toEqual(backend.payment.payload.transaction);
  expect(backend.uploads).toEqual([
    { wallet: payer.address, body: { messageHash: backend.payment.wirePayload.messageHash, signatureBase64: expect.stringMatching(/^[A-Za-z0-9+/]{86}==$/) } },
  ]);
  expect(Object.keys(backend.uploads[0]!.body as object).sort()).toEqual(["messageHash", "signatureBase64"]);
  await capture(page, "approved");
});

live("a payload with one byte the screen can't show opens no prompt and says it doesn't match", async ({ openRoom }) => {
  const world = await openRoom();
  world.backend.tamper((payload) => {
    const bytes = Buffer.from(payload.transactionBase64, "base64");
    bytes[bytes.length - 1]! ^= 1;
    return { ...payload, transactionBase64: bytes.toString("base64") };
  });
  await signIn(world);
  await approve(world.page).click();
  await expect(world.page.getByText(REQUEST_PROBLEMS.mismatch)).toBeVisible();
  expect(prompts(world.wallet)).toEqual(["Phantom connect", "Phantom signMessage"]);
  expect(world.backend.uploads).toEqual([]);
});

live("Approve for a room that moved to a new attempt opens no prompt and says it moved on beside the new Approve", async ({ openRoom }) => {
  const world = await openRoom();
  await signIn(world);
  const { page, wallet, backend } = world;
  backend.moveOnAtPayload((room) => ({ ...room, attempt: { ...room.attempt!, id: `b7${room.attempt!.id.slice(2)}` } }));
  await approve(page).click();
  await expect(page.getByText(REQUEST_PROBLEMS.room_changed)).toBeVisible();
  await expect(approve(page), "the new attempt's Approve").toBeVisible();
  expect(prompts(wallet)).toEqual(["Phantom connect", "Phantom signMessage"]);
  expect(backend.uploads).toEqual([]);
});

live("Approve for a room where this payer already approved opens no prompt and leaves the status line to say so", async ({ openRoom }) => {
  const world = await openRoom();
  await signIn(world);
  const { page, wallet, backend, payer } = world;
  backend.moveOnAtPayload((room) => ({ ...room, attempt: { ...room.attempt!, signedWallets: [payer.address] } }));
  await approve(page).click();
  await expect(page.locator("[data-status-block]")).toContainText("You approved.");
  await expect(approve(page)).toHaveCount(0);
  await expect(approving(page)).toHaveCount(0);
  await expect(page.getByText(REQUEST_PROBLEMS.room_changed)).toHaveCount(0);
  expect(prompts(wallet)).toEqual(["Phantom connect", "Phantom signMessage"]);
  expect(backend.uploads).toEqual([]);
});

live("refusing in the wallet offers Decline without sending it, and approving again then uploads", async ({ openRoom }) => {
  const world = await openRoom();
  await signIn(world);
  const { page, wallet, backend } = world;
  wallet.rejectNext("signTransaction");
  await approve(page).click();
  await expect(page.getByText(REQUEST_PROBLEMS.rejected)).toBeVisible();
  await expect(page.getByRole("button", { name: ACTIONS.decline.label })).toBeVisible();
  expect(backend.uploads).toEqual([]);
  await capture(page, "refused");

  await approve(page).click();
  await expect.poll(() => backend.uploads.length).toBe(1);
  await expect(approving(page)).toHaveCount(0);
  await expect(approve(page)).toHaveCount(0);
  expect(prompts(wallet).filter((p) => p.endsWith("signTransaction"))).toHaveLength(2);
});
