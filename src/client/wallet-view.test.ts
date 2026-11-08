import { describe, expect, it } from "vitest";
import { initialState, step, type Problem, type SessionState } from "@/lib/wallet/machine";
import type { Address } from "./contracts";
import { deriveWalletView } from "./wallet-view";

const BEA = "SAMPLEpayerBea11111111111111111111111111Bea2" as Address;
const SIGN_PROMPT =
  "Sign the sign-in message in your wallet. It proves the wallet is yours and can't move money.";

const BRIEF: Record<Problem, { readonly message: string; readonly action: string }> = {
  no_wallet: { message: "No Solana wallet found. Install Phantom, then reload this page.", action: "Get Phantom" },
  wrong_network: {
    message: "Your wallet isn't on Solana Devnet. Switch it to Devnet, then connect again.",
    action: "Connect wallet",
  },
  connect_rejected: { message: "You closed the connection request. Nothing was shared.", action: "Connect wallet" },
  sign_rejected: { message: "You didn't sign in. Nothing was signed or sent.", action: "Sign in again" },
  cannot_sign: { message: "This wallet can't sign in to OneTab. Use Phantom.", action: "Get Phantom" },
  challenge_stale: { message: "That sign-in message expired. Sign in again for a new one.", action: "Sign in again" },
  unavailable: { message: "Sign-in isn't available right now. Try again in a moment.", action: "Try again" },
  account_switched: {
    message: "Your wallet switched to SAMP…Bea2. Sign in again to continue as that wallet.",
    action: "Sign in again",
  },
  session_expired: {
    message: "Your sign-in expired. Sign in again with the same wallet to continue.",
    action: "Sign in again",
  },
};

const connectedWith = (problem: Problem): SessionState =>
  ({ ...initialState({ account: BEA, session: null }), problem }) as SessionState;

describe("wallet view", () => {
  for (const [problem, expected] of Object.entries(BRIEF) as [Problem, (typeof BRIEF)[Problem]][]) {
    it(`${problem} shows the brief's message and its one action`, () => {
      const { status, connectAction } = deriveWalletView(connectedWith(problem));
      expect(status).toMatchObject({ kind: "problem", text: expected.message, fix: { label: expected.action } });
      expect(connectAction, "the room's Connect wallet offers the status line's fix").toEqual(status?.kind === "problem" && status.fix);
    });
  }

  it("a problem before connecting gives the room's Connect wallet the same fix, Get Phantom included", () => {
    const signedOut = (problem: Problem) => ({ ...initialState({ account: null, session: null }), problem }) as SessionState;
    expect(deriveWalletView(signedOut("no_wallet")).connectAction).toEqual({
      kind: "get_phantom",
      label: "Get Phantom",
      href: "https://phantom.com/download",
    });
    expect(deriveWalletView(signedOut("connect_rejected")).connectAction).toEqual({ kind: "connect_wallet", label: "Connect wallet" });
  });

  it("Get Phantom links to Phantom's download page", () => {
    const { status } = deriveWalletView(connectedWith("no_wallet"));
    expect(status?.kind === "problem" && status.fix).toEqual({
      kind: "get_phantom",
      label: "Get Phantom",
      href: "https://phantom.com/download",
    });
  });

  it("signed out offers Connect wallet and no status", () => {
    expect(deriveWalletView(initialState({ account: null, session: null }))).toEqual({
      control: { kind: "connect", label: "Connect wallet" },
      status: null,
      connectAction: { kind: "connect_wallet", label: "Connect wallet" },
    });
  });

  it("names the open prompt with a busy header while Connect wallet runs", () => {
    const connecting = step(initialState({ account: null, session: null }), { type: "connect" }).state;
    expect(deriveWalletView(connecting)).toEqual({
      control: { kind: "busy", label: "Connecting…" },
      status: { kind: "waiting", text: "Approve the connection in your wallet." },
      connectAction: { kind: "busy", label: "Connecting…" },
    });

    const challenge = { id: "c", message: { text: "Sign in", bytes: new Uint8Array() } };
    const signing = { kind: "signing_in", account: BEA, step: { at: "signature", challenge }, gen: 3 } as unknown as SessionState;
    expect(deriveWalletView(signing)).toEqual({
      control: { kind: "busy", label: "Signing in…" },
      status: { kind: "waiting", text: SIGN_PROMPT },
      connectAction: { kind: "busy", label: "Signing in…" },
    });

    const verifying = { kind: "signing_in", account: BEA, step: { at: "verify", challengeId: "c" }, gen: 4 } as unknown as SessionState;
    expect(deriveWalletView(verifying).status).toEqual({ kind: "waiting", text: "Signing in…" });
  });

  it("signed in shows the address in the header and announces who is signed in", () => {
    const view = deriveWalletView(initialState({ account: BEA, session: { wallet: BEA, expiresAt: "2099-01-01T00:00:00.000Z" } }));
    expect(view).toEqual({
      control: { kind: "account", address: BEA, signedIn: true },
      status: { kind: "signed_in", text: "Signed in as SAMP…Bea2." },
      connectAction: null,
    });
  });

  it("names the payment prompt, with a busy header, while the signed-in wallet approves", () => {
    const signedIn = initialState({ account: BEA, session: { wallet: BEA, expiresAt: "2099-01-01T00:00:00.000Z" } });
    expect(deriveWalletView(signedIn, true)).toEqual({
      control: { kind: "busy", label: "Approving…" },
      status: { kind: "waiting", text: "Approve the payment in your wallet. It covers every share in one payment." },
      connectAction: { kind: "busy", label: "Approving…" },
    });
  });

  it("a payment prompt changes nothing once the wallet isn't signed in", () => {
    expect(deriveWalletView(connectedWith("account_switched"), true)).toEqual(deriveWalletView(connectedWith("account_switched")));
  });

  it("a connected wallet that isn't signed in shows its address and never claims a sign-in", () => {
    expect(deriveWalletView(connectedWith("account_switched")).control).toEqual({ kind: "account", address: BEA, signedIn: false });
  });
});
