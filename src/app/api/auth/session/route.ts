import { endSession, readSession } from "@/server/auth/service";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const result = await readSession();
  return result.ok
    ? Response.json({ data: result.value }, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: { code: result.code, message: "Could not read session." } }, { status: 503, headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const configured = process.env.APP_ORIGIN;
  if (!configured || origin !== configured) {
    return Response.json({ error: { code: "ORIGIN_MISMATCH", message: "Request origin is not allowed." } }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  await endSession();
  return Response.json({ data: null }, { headers: { "cache-control": "no-store" } });
}
