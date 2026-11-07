import { joinRoom, parseRoomId, requestOriginAllowed } from "@/server/rooms/service";
import { requireWalletSession } from "@/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!requestOriginAllowed(request)) return reply(403, "ORIGIN_MISMATCH");
  const actor = await requireWalletSession();
  if (!actor.ok) return reply(actor.code === "UNAUTHENTICATED" ? 401 : 503, actor.code);
  const { id: rawId } = await context.params;
  const id = parseRoomId(rawId);
  if (!id) return reply(404, "CHECKOUT_NOT_FOUND");
  const result = await joinRoom(id, actor.value.wallet);
  if (!result.ok) return reply(result.code === "CHECKOUT_NOT_FOUND" ? 404 : result.code === "ROOM_FULL" || result.code === "CHECKOUT_PAID" || result.code === "ATTEMPT_NOT_SIGNABLE" ? 409 : result.code === "FORBIDDEN" ? 403 : 503, result.code);
  return Response.json({ data: result.value }, { headers: { "cache-control": "no-store" } });
}

function reply(status: number, code: string): Response { return Response.json({ error: { code, message: "Could not join checkout." } }, { status, headers: { "cache-control": "no-store" } }); }
