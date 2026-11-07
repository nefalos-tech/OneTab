import { getRoom, parseRoomId } from "@/server/rooms/service";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: rawId } = await context.params;
  const id = parseRoomId(rawId);
  if (!id) return reply(404, "CHECKOUT_NOT_FOUND");
  const result = await getRoom(id);
  if (!result.ok) return reply(result.code === "CHECKOUT_NOT_FOUND" ? 404 : 503, result.code);
  return Response.json({ data: result.value }, { headers: { "cache-control": "no-store" } });
}

function reply(status: number, code: string): Response { return Response.json({ error: { code, message: code === "CHECKOUT_NOT_FOUND" ? "Checkout was not found." : "Could not read checkout." } }, { status, headers: { "cache-control": "no-store" } }); }
