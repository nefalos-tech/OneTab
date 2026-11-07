import type { Address, Session } from "@/client/contracts";
import {
  authMessage,
  type BridgeResult,
  type ChallengeId,
  type SignatureBase64,
  type SignInService,
  type WalletBridge,
  type WalletEnvironment,
} from "./environment";
import { initialState, type SessionState } from "./machine";

export type SampleAccount = { readonly label: string; readonly wallet: Address };

export type SampleWalletSeed = {
  readonly accounts: readonly SampleAccount[];
  readonly selected: Address;
};

export type SamplePrompt =
  | { readonly kind: "connect" }
  | { readonly kind: "sign"; readonly account: Address; readonly text: string };

export type SampleWalletView = {
  readonly accounts: readonly SampleAccount[];
  readonly selected: Address;
  readonly connected: boolean;
  readonly prompt: SamplePrompt | null;
};

export type SampleWallet = {
  /** Stable between changes, so it can be useSyncExternalStore's snapshot. */
  view(): SampleWalletView;
  subscribe(listener: () => void): () => void;
  approve(): void;
  reject(): void;
  select(wallet: Address): void;
};

export type SampleEnvironment = {
  readonly environment: WalletEnvironment;
  readonly wallet: SampleWallet;
  readonly initial: SessionState;
};

export const SAMPLE_SIGN_IN_EXPIRY = "2099-01-01T00:00:00.000Z";

type Pending =
  | {
      readonly kind: "connect";
      readonly prompt: Extract<SamplePrompt, { kind: "connect" }>;
      readonly settle: (r: BridgeResult<Address>) => void;
    }
  | {
      readonly kind: "sign";
      readonly prompt: Extract<SamplePrompt, { kind: "sign" }>;
      readonly settle: (r: BridgeResult<SignatureBase64>) => void;
    };

const FAILED = { ok: false, failure: "failed" } as const;
const REJECTED = { ok: false, failure: "rejected" } as const;

export function sampleEnvironment(seed: SampleWalletSeed, session: Session | null): SampleEnvironment {
  let selected = seed.selected;
  let connected = session !== null;
  let pending: Pending | null = null;
  const viewListeners = new Set<() => void>();
  const accountListeners = new Set<(account: Address | null) => void>();
  let snapshot = viewOf();

  function viewOf(): SampleWalletView {
    return { accounts: seed.accounts, selected, connected, prompt: pending?.prompt ?? null };
  }

  function changed(): void {
    snapshot = viewOf();
    for (const listener of viewListeners) listener();
  }

  function dropPending(): void {
    const dropped = pending;
    pending = null;
    if (dropped) dropped.settle(FAILED);
  }

  const bridge: WalletBridge = {
    connect() {
      dropPending();
      return new Promise((resolve) => {
        pending = { kind: "connect", prompt: { kind: "connect" }, settle: resolve };
        changed();
      });
    },
    async disconnect() {
      connected = false;
      dropPending();
      changed();
    },
    signAuthentication({ account, message }) {
      if (!connected || account !== selected) return Promise.resolve(FAILED);
      dropPending();
      return new Promise((resolve) => {
        pending = { kind: "sign", prompt: { kind: "sign", account, text: message.text }, settle: resolve };
        changed();
      });
    },
    signPayment: async () => FAILED,
    onAccountChange(listener) {
      accountListeners.add(listener);
      return () => accountListeners.delete(listener);
    },
  };

  const wallet: SampleWallet = {
    view: () => snapshot,
    subscribe(listener) {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    approve() {
      const open = pending;
      if (!open) return;
      pending = null;
      if (open.kind === "connect") {
        connected = true;
        changed();
        open.settle({ ok: true, value: selected });
      } else {
        changed();
        open.settle({ ok: true, value: sampleSignature(open.prompt.account, open.prompt.text) });
      }
    },
    reject() {
      const open = pending;
      if (!open) return;
      pending = null;
      changed();
      open.settle(REJECTED);
    },
    select(next) {
      if (next === selected) return;
      selected = next;
      changed();
      if (connected) for (const listener of accountListeners) listener(next);
    },
  };

  return {
    environment: { bridge, service: sampleSignInService(session) },
    wallet,
    initial: initialState({ account: session === null ? null : seed.selected, session }),
  };
}

function sampleSignInService(initial: Session | null): SignInService {
  let session = initial;
  let issued = 0;
  const challenges = new Map<ChallengeId, { readonly wallet: Address; readonly text: string; used: boolean }>();

  return {
    async readSession() {
      return { ok: true, value: session };
    },
    async requestChallenge(wallet) {
      issued += 1;
      const id = `sample-challenge-${issued}` as ChallengeId;
      const text = `Sign in to OneTab sample data as ${wallet}. Signing in can't move money. Nonce ${issued}.`;
      const message = authMessage(new TextEncoder().encode(text));
      if (!message) return { ok: false, failure: "unavailable" };
      challenges.set(id, { wallet, text, used: false });
      return { ok: true, value: { id, message } };
    },
    async verify({ challengeId, signature }) {
      const challenge = challenges.get(challengeId);
      if (!challenge || challenge.used) return { ok: false, failure: "stale_challenge" };
      if (signature !== sampleSignature(challenge.wallet, challenge.text)) return { ok: false, failure: "unavailable" };
      challenge.used = true;
      session = { wallet: challenge.wallet, expiresAt: SAMPLE_SIGN_IN_EXPIRY };
      return { ok: true, value: session };
    },
    async endSession() {
      session = null;
    },
  };
}

function sampleSignature(wallet: Address, messageText: string): SignatureBase64 {
  return btoa(`sample-signature:${wallet}:${messageText}`) as SignatureBase64;
}
