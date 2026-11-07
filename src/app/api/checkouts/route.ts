import { createRoom, requestOriginAllowed } from "@/server/rooms/service";
import { isRecord } from "@/client/contracts";
import { requireWalletSession } from "@/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!requestOriginAllowed(request)) return reply(403, "ORIGIN_MISMATCH");
  const actor = await requireWalletSession();
  if (!actor.ok) return reply(actor.code === "UNAUTHENTICATED" ? 401 : 503, actor.code);
  let body: unknown;
  try { body = await request.json(); } catch { return reply(400, "INVALID_INPUT"); }
  if (!isRecord(body)) return reply(400, "INVALID_INPUT");
  const result = await createRoom(body, actor.value.wallet);
  if (!result.ok) return reply(statusFor(result.code), result.code);
  return Response.json({ data: result.value }, { status: 201, headers: { "cache-control": "no-store" } });
}

function statusFor(code: string): number { return code === "INVALID_INPUT" ? 400 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" || code === "ORIGIN_MISMATCH" ? 403 : code === "IDEMPOTENCY_CONFLICT" ? 409 : 503; }
function reply(status: number, code: string): Response { return Response.json({ error: { code, message: code === "INVALID_INPUT" ? "Checkout input is invalid." : "Could not create checkout." } }, { status, headers: { "cache-control": "no-store" } }); }
