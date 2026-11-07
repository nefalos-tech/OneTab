import type { Metadata } from "next";
import { loadCheckout } from "@/client/checkout-source";
import { Viewer } from "@/components/viewer";

export async function generateMetadata(props: PageProps<"/checkouts/[id]/result">): Promise<Metadata> {
  return { title: `${(await loadCheckout(props)).snapshot.checkout.title} payment | OneTab` };
}

export default async function ResultPage(props: PageProps<"/checkouts/[id]/result">) {
  return <Viewer screen="result" state={await loadCheckout(props)} />;
}
