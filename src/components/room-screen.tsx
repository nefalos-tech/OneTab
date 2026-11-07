import type { ReactNode } from "react";
import { deriveRoomView, type CheckoutState } from "@/client/checkout-view";
import { PageShell } from "./page-shell";
import { SpotList } from "./spot-list";
import { StatusPanel } from "./status-panel";
import { TabCard } from "./tab-card";

export function RoomScreen({ state }: { readonly state: CheckoutState }): ReactNode {
  const view = deriveRoomView(state);
  return (
    <PageShell
      chrome={view.chrome}
      layout="split"
      main={<TabCard tab={view.tab} heading="h1" hero={view.you === null} />}
      side={
        <StatusPanel
          status={view.status}
          you={view.you}
          approval={view.approval}
          actions={view.actions}
          heading="h2"
          connection={view.connection}
        />
      }
      mainEnd={<SpotList spots={view.tab.spots} />}
    />
  );
}
