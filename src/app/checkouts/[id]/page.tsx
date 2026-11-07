import type { Metadata } from "next";
import { loadCheckout } from "@/client/checkout-source";
import { RoomScreen } from "@/components/room-screen";

export async function generateMetadata(props: PageProps<"/checkouts/[id]">): Promise<Metadata> {
  return { title: `${(await loadCheckout(props)).snapshot.checkout.title} | OneTab` };
}

export default async function RoomPage(props: PageProps<"/checkouts/[id]">) {
  return <RoomScreen state={await loadCheckout(props)} />;
}
