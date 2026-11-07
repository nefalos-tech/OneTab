import type { Metadata } from "next";
import { loadCheckout } from "@/client/checkout-source";
import { ResultScreen } from "@/components/result-screen";

export async function generateMetadata(props: PageProps<"/checkouts/[id]/result">): Promise<Metadata> {
  return { title: `${(await loadCheckout(props)).snapshot.checkout.title} payment | OneTab` };
}

export default async function ResultPage(props: PageProps<"/checkouts/[id]/result">) {
  return <ResultScreen state={await loadCheckout(props)} />;
}
