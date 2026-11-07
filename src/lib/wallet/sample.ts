// The sample environment: an in-page wallet and an in-memory sign-in service built together, so
// sample data can never pair with a real wallet or a real route. Nothing here calls fetch or reads
// window wallets. The same object is the scriptable fake for unit tests: tests call approve(),
// reject() and select() exactly as the panel's buttons do.

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

/** Built by src/client/fixtures.ts from the `?as=` persona and carried on the sample `source`. */
export type SampleWalletSeed = {
  readonly accounts: readonly SampleAccount[];
  /** The persona's wallet, or the outsider for the signed-out persona (what Connect wallet would share). */
  readonly selected: Address;
};

/** The connect prompt shares whichever account is selected when the user approves. */
export type SamplePrompt =
  | { readonly kind: "connect" }
  | { readonly kind: "sign"; readonly account: Address; readonly text: string };

/** What the sample wallet panel renders. */
export type SampleWalletView = {
  readonly accounts: readonly SampleAccount[];
  readonly selected: Address;
  readonly connected: boolean;
  /** At most one open prompt, like a wallet popup. A newer request replaces it and fails the older one. */
  readonly prompt: SamplePrompt | null;
};

/** The panel's (and tests') handle on the device. */
export type SampleWallet = {
  /** Stable between changes, so it can be useSyncExternalStore's snapshot. */
  view(): SampleWalletView;
  subscribe(listener: () => void): () => void;
  approve(): void;
  reject(): void;
  /** Switch accounts. While connected, reports the change through onAccountChange. */
  select(wallet: Address): void;
};

export type SampleEnvironment = {
  readonly environment: WalletEnvironment;
  readonly wallet: SampleWallet;
  /** initialState() for this seed, so the server render and the first client render agree. */
  readonly initial: SessionState;
};

/** Sample sign-ins don't expire on their own. The panel's End sign-in shows an expiry instead. */
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

/**
 * `session` is the persona's session from the page state. Non-null means the sample wallet starts
 * connected to `seed.selected` and the sample service starts holding that session.
 */
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

  /** Closes the open prompt, if any, with `failed`, the way a wallet drops a superseded request. */
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

/** An in-memory stand-in for B2's routes. Resolves on a microtask, like a fast server. */
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

/** A deterministic stand-in for a signature. Recognizably fake and never valid on any chain. */
function sampleSignature(wallet: Address, messageText: string): SignatureBase64 {
  return btoa(`sample-signature:${wallet}:${messageText}`) as SignatureBase64;
}
