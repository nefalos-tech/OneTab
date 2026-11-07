import { requireCheckoutAddress } from "@/client/checkout-source";

export default async function CheckoutLayout({ params, children }: LayoutProps<"/checkouts/[id]">) {
  await requireCheckoutAddress(params);
  return children;
}
