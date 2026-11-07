// SessionState to what the header control, the status line and the room's Connect wallet show. Pure,
// with copy from catalog.ts.
// Parallels checkout-view.ts: components render this view and never read machine state.

import type { Problem, SessionState } from "@/lib/wallet/machine";
import type { Address } from "./contracts";
import { WALLET_FIXES, WALLET_PROBLEMS, WALLET_WAITING, WORDS, type WalletFixKind, type WalletWaiting } from "./catalog";

export type WalletFix =
  | { readonly kind: Exclude<WalletFixKind, "get_phantom">; readonly label: string }
  | { readonly kind: "get_phantom"; readonly label: string; readonly href: string };

/**
 * The room's inline Connect wallet. It mirrors the header: the status line's fix while a problem
 * shows, the header's busy label while a wallet prompt or sign-in call is open.
 */
export type ConnectAction = WalletFix | { readonly kind: "busy"; readonly label: string };

export type WalletView = {
  readonly control:
    | { readonly kind: "connect"; readonly label: string }
    | { readonly kind: "busy"; readonly label: string }
    | { readonly kind: "account"; readonly address: Address; readonly signedIn: boolean };
  /** The line under the header, in a polite live region. */
  readonly status:
    | null
    /** A wallet prompt or a sign-in call is open. Offers Cancel. */
    | { readonly kind: "waiting"; readonly text: string }
    | { readonly kind: "problem"; readonly problem: Problem; readonly text: string; readonly fix: WalletFix }
    /** Announced to screen readers only. The header's short address is the visible confirmation. */
    | { readonly kind: "signed_in"; readonly text: string };
  /** null when signed in, where no screen offers Connect wallet. */
  readonly connectAction: ConnectAction | null;
};

/** The same short form AddressText renders, such as SAMP…Bea2. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function deriveWalletView(state: SessionState): WalletView {
  switch (state.kind) {
    case "signed_out": {
      const status = state.problem === null ? null : problemStatus(state.problem, null);
      return {
        control: { kind: "connect", label: WALLET_FIXES.connect_wallet.label },
        status,
        connectAction: status?.fix ?? fixOf("connect_wallet"),
      };
    }
    case "connecting":
      return waiting("connect_prompt");
    case "signing_in":
      return waiting(state.step.at === "signature" ? "sign_prompt" : "server");
    case "connected": {
      const status = problemStatus(state.problem, state.account);
      return { control: { kind: "account", address: state.account, signedIn: false }, status, connectAction: status.fix };
    }
    case "signed_in":
      return {
        control: { kind: "account", address: state.account, signedIn: true },
        status: { kind: "signed_in", text: `${WORDS.signed_in_as} ${shortAddress(state.account)}.` },
        connectAction: null,
      };
  }
}

function waiting(what: WalletWaiting): WalletView {
  const busy = { kind: "busy", label: WALLET_WAITING[what].control } as const;
  return { control: busy, status: { kind: "waiting", text: WALLET_WAITING[what].line }, connectAction: busy };
}

function problemStatus(
  problem: Problem,
  account: Address | null,
): Extract<WalletView["status"], { readonly kind: "problem" }> {
  const { message, fix } = WALLET_PROBLEMS[problem];
  const text = account === null ? message : message.replace("{address}", shortAddress(account));
  return { kind: "problem", problem, text, fix: fixOf(fix) };
}

function fixOf(kind: WalletFixKind): WalletFix {
  return kind === "get_phantom"
    ? { kind, label: WALLET_FIXES.get_phantom.label, href: WALLET_FIXES.get_phantom.href }
    : { kind, label: WALLET_FIXES[kind].label };
}
