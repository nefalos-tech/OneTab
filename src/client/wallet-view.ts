import type { Problem, SessionState } from "@/lib/wallet/machine";
import type { Address } from "./contracts";
import { shortAddress } from "./checkout-view";
import { WALLET_FIXES, WALLET_PROBLEMS, WALLET_WAITING, WORDS, type WalletFixKind, type WalletWaiting } from "./catalog";

export type WalletFix =
  | { readonly kind: Exclude<WalletFixKind, "get_phantom">; readonly label: string }
  | { readonly kind: "get_phantom"; readonly label: string; readonly href: string };

export type ConnectAction = WalletFix | { readonly kind: "busy"; readonly label: string };

export type WalletView = {
  readonly control:
    | { readonly kind: "connect"; readonly label: string }
    | { readonly kind: "busy"; readonly label: string }
    | { readonly kind: "account"; readonly address: Address; readonly signedIn: boolean };
  readonly status:
    | null
    | { readonly kind: "waiting"; readonly text: string }
    | { readonly kind: "problem"; readonly problem: Problem; readonly text: string; readonly fix: WalletFix }
    | { readonly kind: "signed_in"; readonly text: string };
  readonly connectAction: ConnectAction | null;
};

export function deriveWalletView(state: SessionState, approving = false): WalletView {
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
      if (approving) return waiting("payment_prompt");
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
