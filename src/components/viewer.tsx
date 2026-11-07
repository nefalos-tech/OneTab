"use client";
// The screen is chosen by a string prop because a server page can't pass a component function
// across the client boundary.

import type { ReactNode } from "react";
import type { CheckoutState, CreateState } from "@/client/checkout-view";
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
  return <Screen {...props} />;
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
