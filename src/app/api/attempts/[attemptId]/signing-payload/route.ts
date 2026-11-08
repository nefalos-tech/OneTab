import { paymentHandlers } from "@/server/payments/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ attemptId: string }> }) {
  return paymentHandlers.signingPayload(request, (await context.params).attemptId);
}
