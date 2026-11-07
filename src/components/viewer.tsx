"use client";
// The screen is chosen by a string prop because a server page can't pass a component function
// across the client boundary.

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Screen as ScreenName } from "@/client/catalog";
import { NOTHING_HEARD, ownerOf, type CheckoutState, type CreateState, type Session } from "@/client/checkout-view";
import { live, roomTracker } from "@/client/live-actions";
import { RoomTrack } from "./actions";
import { CreateScreen } from "./create-screen";
import { ResultScreen } from "./result-screen";
import { RoomScreen } from "./room-screen";
import { SampleWalletProvider, useWalletSession } from "./wallet/wallet-scope";

export type ViewerProps =
  | { readonly screen: "room" | "result"; readonly state: CheckoutState }
  | { readonly screen: "create"; readonly state: CreateState };

export function Viewer(props: ViewerProps): ReactNode {
  const { source } = props.state;
  if (source.kind === "sample") {
    const key = props.screen === "create" ? `create ${source.wallet.selected}` : props.state.source.links.room;
    return (
      <SampleWalletProvider key={key} seed={source.wallet} session={props.state.session}>
        <Screen {...props} />
      </SampleWalletProvider>
    );
  }
  if (props.screen === "create") return <Screen {...props} />;
  return <LiveCheckout key={props.state.snapshot.checkout.id} screen={props.screen} state={props.state} />;
}

function LiveCheckout({ screen, state }: { readonly screen: ScreenName; readonly state: CheckoutState }): ReactNode {
  const [received, setReceived] = useState<CheckoutState["snapshot"] | null>(null);
  const [roomUnreachable, setRoomUnreachable] = useState(false);
  const [track] = useState(() => roomTracker(setReceived, (answered) => setRoomUnreachable(!answered)));
  const noted = useSyncExternalStore(live.noted.subscribe, live.noted.current, () => NOTHING_HEARD.noted);
  const { session, expired } = useWalletSession();
  const router = useRouter();
  const snapshot = received ?? state.snapshot;
  const id = state.snapshot.checkout.id;

  const now = useEffectEvent(() => ({ snapshot, session }));
  const signedOut = useEffectEvent((ended: Session) => expired(ended));
  useEffect(() => live.watch({ id, track, now, signedOut }), [id, track]);

  // The first room the browser reads, not the loaded one, sets where the viewer stands: Back restores a
  // page with the room it had then, and moving away from it would bounce the viewer back.
  const lastOwner = useRef<ScreenName | null>(null);
  useEffect(() => {
    if (received === null) return;
    const next = ownerOf(received);
    const moved = lastOwner.current !== null && next !== lastOwner.current;
    lastOwner.current = next;
    if (moved && next !== screen) router.push(state.source.links[next]);
  }, [received, screen, router, state.source.links]);

  return (
    <RoomTrack value={track}>
      <Screen screen={screen} state={{ ...state, snapshot, page: { noted, roomUnreachable } }} />
    </RoomTrack>
  );
}

function Screen(props: ViewerProps): ReactNode {
  const { session } = useWalletSession();
  switch (props.screen) {
    case "room":
      return <RoomScreen state={{ ...props.state, session }} />;
    case "result":
      return <ResultScreen state={{ ...props.state, session }} />;
    case "create":
      return <CreateScreen state={{ ...props.state, session }} />;
  }
}
