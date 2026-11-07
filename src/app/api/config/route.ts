import { publicConfig } from "@/server/rooms/service";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const result = publicConfig();
  return result.ok
    ? Response.json({ data: result.value }, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: { code: result.code, message: "Public payment configuration is unavailable." } }, { status: 503, headers: { "cache-control": "no-store" } });
}
