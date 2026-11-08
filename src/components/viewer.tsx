"use client";
// The screen is chosen by a string prop because a server page can't pass a component function
// across the client boundary.

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Screen as ScreenName } from "@/client/catalog";
import { NOTHING_HEARD, ownerOf, type CheckoutState, type CreateState, type Session } from "@/client/checkout-view";
import { live, pageMoves, type Intent } from "@/client/live-actions";
import { RoomTrack } from "./actions";
import { CreateScreen } from "./create-screen";
import { ResultScreen } from "./result-screen";
import { RoomScreen } from "./room-screen";
import { ArrivedByMove } from "./status-panel";
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

const noChanges = () => () => {};

function LiveCheckout({ screen, state }: { readonly screen: ScreenName; readonly state: CheckoutState }): ReactNode {
  const [received, setReceived] = useState<{ readonly snapshot: CheckoutState["snapshot"]; readonly intent: Intent } | null>(null);
  const [roomUnreachable, setRoomUnreachable] = useState(false);
  const hydrating = useSyncExternalStore(noChanges, () => false, () => true);
  const [arrived] = useState(() => live.arrivals.movedTo(state.source.links[screen]));
  useEffect(() => live.arrivals.landed(), []);
  const [moves] = useState(() => pageMoves(hydrating ? "loaded" : arrived ? "moved" : "navigated", screen, ownerOf(state.snapshot)));
  const [track] = useState(() =>
    live.tracker({
      show: (snapshot, intent) => setReceived({ snapshot, intent }),
      reached: (answered) => setRoomUnreachable(!answered),
      acting: moves.acting,
    }),
  );
  const noted = useSyncExternalStore(live.noted.subscribe, live.noted.current, () => NOTHING_HEARD.noted);
  const { session, expired } = useWalletSession();
  const router = useRouter();
  const snapshot = received?.snapshot ?? state.snapshot;
  const id = state.snapshot.checkout.id;

  const now = useEffectEvent(() => ({ snapshot, session }));
  const signedOut = useEffectEvent((ended: Session) => expired(ended));
  useEffect(() => live.watch({ id, track, now, signedOut }), [id, track]);

  useEffect(() => {
    if (received === null) return;
    const to = moves.shown({ owner: ownerOf(received.snapshot), intent: received.intent });
    if (to === null) return;
    live.arrivals.moveTo(state.source.links[to]);
    router.push(state.source.links[to]);
  }, [received, moves, router, state.source.links]);

  return (
    <RoomTrack value={track}>
      <ArrivedByMove value={arrived}>
        <Screen screen={screen} state={{ ...state, snapshot, page: { noted, roomUnreachable } }} />
      </ArrivedByMove>
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
