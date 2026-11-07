import { paymentHandlers } from "@/server/payments/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ attemptId: string }> }) {
  return paymentHandlers.refresh(request, (await context.params).attemptId);
}
