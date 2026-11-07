import { isRecord } from "@/client/contracts";
import { expectedOrigin, verifyChallenge } from "@/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const origin = expectedOrigin(request);
  if (!origin) return reply(403, "ORIGIN_MISMATCH", "Request origin is not allowed.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, "INVALID_INPUT", "Request body must be JSON.");
  }
  if (!isRecord(body)) return reply(400, "INVALID_INPUT", "Request body is invalid.");
  const result = await verifyChallenge({ id: body.challengeId, signature: body.signatureBase64, origin });
  if (!result.ok) {
    const status = result.code === "RATE_LIMITED" ? 429
      : result.code === "INVALID_INPUT" || result.code === "INVALID_SIGNATURE" ? 400
      : result.code === "CHALLENGE_EXPIRED" || result.code === "CHALLENGE_USED" ? 401
        : result.code === "ORIGIN_MISMATCH" ? 403 : 503;
    return reply(status, result.code, "Could not verify sign-in.");
  }
  return Response.json({ data: result.value }, { headers: { "cache-control": "no-store" } });
}

function reply(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}
