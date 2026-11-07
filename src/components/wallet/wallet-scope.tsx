"use client";

import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Session } from "@/client/checkout-view";
import { deriveWalletView, type WalletView } from "@/client/wallet-view";
import { liveEnvironment } from "@/lib/wallet/live";
import { initialState, sessionOf } from "@/lib/wallet/machine";
import { sampleEnvironment, type SampleWallet, type SampleWalletSeed } from "@/lib/wallet/sample";
import { createSessionStore, type SessionStore } from "@/lib/wallet/store";


export type WalletSessionApi = {
  readonly view: WalletView;
  readonly session: Session | null;
  connect(): void;
  cancel(): void;
  disconnect(): void;
  expired(session: Session): void;
};

const StoreContext = createContext<SessionStore | null>(null);
const SampleContext = createContext<SampleWallet | null>(null);

/**
 * The root layout never remounts on client navigation, so a live sign-in survives moving between
 * the room, the result and create. Created per mount rather than as a module singleton, so server
 * requests never share a store.
 */
export function LiveWalletProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [store] = useState(() => createSessionStore(liveEnvironment(), initialState({ account: null, session: null })));
  useEffect(() => store.start(), [store]);
  return <StoreContext value={store}>{children}</StoreContext>;
}

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

export function useSampleWallet(): SampleWallet | null {
  return use(SampleContext);
}
