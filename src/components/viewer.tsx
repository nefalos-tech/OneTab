"use client";
// The screen is chosen by a string prop because a server page can't pass a component function
// across the client boundary.

import { useState, type ReactNode } from "react";
import type { CheckoutState, CreateState } from "@/client/checkout-view";
import { roomTracker } from "@/client/live-actions";
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

/**
 * One live checkout. It shows the newest room a browser request returned, else the server's load, and
 * the tracker decides which reply is newest. Keyed by checkout ID, so no reply crosses to another
 * checkout. F4's poll joins here through live.refresh with this tracker.
 */
function LiveCheckout({ screen, state }: { readonly screen: "room" | "result"; readonly state: CheckoutState }): ReactNode {
  const [received, setReceived] = useState<CheckoutState["snapshot"] | null>(null);
  const [track] = useState(() => roomTracker(setReceived));
  return (
    <RoomTrack value={track}>
      <Screen screen={screen} state={received === null ? state : { ...state, snapshot: received }} />
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
