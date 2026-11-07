import { paymentHandlers } from "@/server/payments/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return paymentHandlers.prepare(request, (await context.params).id);
}
