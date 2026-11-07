import { requireCheckout } from "@/client/checkout-source";

export default async function CheckoutLayout({ params, children }: LayoutProps<"/checkouts/[id]">) {
  await requireCheckout(params);
  return children;
}
