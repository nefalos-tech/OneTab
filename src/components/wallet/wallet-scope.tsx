"use client";
// The only file that pairs a store with an environment. Components reach wallets through
// useWalletSession() and nothing else.

import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CheckoutState } from "@/client/checkout-view";
import { deriveWalletView, type WalletView } from "@/client/wallet-view";
import { liveEnvironment } from "@/lib/wallet/live";
import { initialState, sessionOf } from "@/lib/wallet/machine";
import { sampleEnvironment, type SampleWallet, type SampleWalletSeed } from "@/lib/wallet/sample";
import { createSessionStore, type SessionStore } from "@/lib/wallet/store";

/** Components may not import @/client/contracts, so the Session type comes through the view state. */
type Session = NonNullable<CheckoutState["session"]>;

export type WalletSessionApi = {
  readonly view: WalletView;
  /** The signed-in identity, always the wallet's current account, or null. */
  readonly session: Session | null;
  /** Connect wallet, Sign in again and Try again all send this one intent. */
  connect(): void;
  /** The exit door while a wallet prompt or sign-in step is open. */
  cancel(): void;
  disconnect(): void;
  /** The server said this session ended (401 UNAUTHENTICATED, or the panel's End sign-in). */
  expired(session: Session): void;
};

const StoreContext = createContext<SessionStore | null>(null);
const SampleContext = createContext<SampleWallet | null>(null);

/**
 * In src/app/layout.tsx around {children}. The root layout never remounts on client navigation, so a
 * live sign-in survives moving between the room, the result and create. Created per mount rather
 * than as a module singleton, so server requests never share a store.
 */
export function LiveWalletProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [store] = useState(() => createSessionStore(liveEnvironment(), initialState({ account: null, session: null })));
  useEffect(() => store.start(), [store]);
  return <StoreContext value={store}>{children}</StoreContext>;
}

/**
 * Shadows the live store for one sample page. Viewer keys it by the persona's link, so choosing
 * another persona or sample reseeds it, and the persona stays the starting viewer.
 */
export function SampleWalletProvider({
  seed,
  session,
  children,
}: {
  readonly seed: SampleWalletSeed;
  readonly session: Session | null;
  readonly children: ReactNode;
}): ReactNode {
  const [sample] = useState(() => {
    const env = sampleEnvironment(seed, session);
    return { store: createSessionStore(env.environment, env.initial), wallet: env.wallet };
  });
  useEffect(() => sample.store.start(), [sample]);
  return (
    <StoreContext value={sample.store}>
      <SampleContext value={sample.wallet}>{children}</SampleContext>
    </StoreContext>
  );
}

export function useWalletSession(): WalletSessionApi {
  const store = use(StoreContext);
  if (store === null) throw new Error("useWalletSession needs LiveWalletProvider in the root layout");
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(
    () => ({
      view: deriveWalletView(state),
      session: sessionOf(state),
      connect: () => store.send({ type: "connect" }),
      cancel: () => store.send({ type: "cancel" }),
      disconnect: () => store.send({ type: "disconnect" }),
      expired: (session: Session) => store.send({ type: "expired", session }),
    }),
    [store, state],
  );
}

/** null outside a sample page. Only SampleWalletPanel calls it. */
export function useSampleWallet(): SampleWallet | null {
  return use(SampleContext);
}
