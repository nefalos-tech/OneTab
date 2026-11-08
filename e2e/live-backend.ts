import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { address, getAddressEncoder } from "@solana/kit";
import type { RoomSnapshot as WireRoom, SigningPayload as WirePayload } from "../src/contracts/index";
import { keyedPayment, type KeyedPayment } from "../src/client/keyed-payment-fixture";
import { verifyPayerSignature } from "../src/lib/payments/signature-core";
import type { Answer, Backend } from "./browser-api";
import { installRoom, installedRoom } from "./fake-api.mjs";

type Write = { readonly wallet: string; readonly body: unknown };

export type LiveBackend = {
  readonly payment: KeyedPayment;
  readonly roomId: string;
  /** One browser's server. Each keeps its own session, as its cookie would. */
  server(): Backend;
  /** From now on the signing payload carries this change. The room stays honest. */
  tamper(change: (payload: WirePayload) => WirePayload): void;
  /** The next signing payload read installs this change to the room first, so the room the page reads next has moved on. */
  moveOnAtPayload(change: (room: WireRoom) => WireRoom): void;
  /** Every challenge message the server issued, as bytes. */
  readonly issued: readonly Uint8Array[];
  readonly verifies: readonly string[];
  /** Every approval the server accepted, with the exact body the page sent. */
  readonly uploads: readonly Write[];
};

const json = (status: number, body: unknown): Answer => ({ status, body });
const error = (status: number, code: string): Answer => json(status, { error: { code, message: "Shown nowhere." } });
const isCanonical64 = (text: unknown): text is string =>
  typeof text === "string" && text.length === 88 && Buffer.from(text, "base64").length === 64 && Buffer.from(text, "base64").toString("base64") === text;

/**
 * Stands in for B2's sign-in routes and Payments' attempt routes, which can't run in e2e: its servers have no
 * APP_ORIGIN, database or RPC. Each check is the real one: Ed25519 over the issued challenge, as
 * src/server/auth/service.ts verifies it, and Payments' verifyPayerSignature on upload, as the server does.
 */
export async function liveBackend(request: APIRequestContext, origin: string): Promise<LiveBackend> {
  const roomId = installedRoom();
  const payment = await keyedPayment(3, { checkoutId: roomId, attemptId: installedRoom() });
  let room: WireRoom = payment.wireRoom;
  let payload: WirePayload = payment.wirePayload;
  const challenges = new Map<string, { readonly wallet: string; readonly bytes: Uint8Array }>();
  const issued: Uint8Array[] = [];
  const verifies: string[] = [];
  const uploads: Write[] = [];
  let moveOn: ((room: WireRoom) => WireRoom) | null = null;

  const install = async (next: WireRoom) => {
    room = next;
    const put = await request.put(installRoom(roomId), { data: next });
    if (!put.ok()) throw new Error(`The fake API didn't install room ${roomId}`);
  };
  await install(room);

  return {
    payment,
    roomId,
    issued,
    verifies,
    uploads,
    tamper(change) {
      payload = change(payload);
    },
    moveOnAtPayload(change) {
      moveOn = change;
    },
    server() {
      let session: { readonly wallet: string; readonly expiresAt: string } | null = null;
      const attempt = room.attempt!.id;
      return async (sent, url) => {
        const method = sent.method();
        const route = `${method} ${url.pathname}`;
        const body: Record<string, unknown> = method === "GET" || method === "DELETE" ? {} : (sent.postDataJSON() ?? {});
        if (route === "GET /api/auth/session") return json(200, { data: session });
        if (route === "DELETE /api/auth/session") return (session = null), json(200, { data: null });
        if (route === "POST /api/auth/challenge") {
          const wallet = String(body.wallet);
          const id = randomUUID();
          const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
          const lines = ["OneTab sign-in", `Origin: ${origin}`, `Wallet: ${wallet}`, "Purpose: authenticate", `Challenge: ${id}`, `Expires: ${expiresAt}`];
          const bytes = new TextEncoder().encode(lines.join("\n"));
          challenges.set(id, { wallet, bytes });
          issued.push(bytes);
          return json(200, { data: { challengeId: id, messageBase64: Buffer.from(bytes).toString("base64"), expiresAt } });
        }
        if (route === "POST /api/auth/verify") {
          verifies.push(String(body.signatureBase64));
          const challenge = challenges.get(String(body.challengeId));
          challenges.delete(String(body.challengeId));
          if (!challenge) return error(400, "CHALLENGE_USED");
          if (!isCanonical64(body.signatureBase64)) return error(400, "INVALID_SIGNATURE");
          const keyBytes = Uint8Array.from(getAddressEncoder().encode(address(challenge.wallet)));
          const key = await crypto.subtle.importKey("raw", keyBytes, "Ed25519", false, ["verify"]);
          if (!(await crypto.subtle.verify("Ed25519", key, Buffer.from(body.signatureBase64, "base64"), Uint8Array.from(challenge.bytes)))) return error(400, "INVALID_SIGNATURE");
          session = { wallet: challenge.wallet, expiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString() };
          return json(200, { data: session });
        }
        if (url.pathname.startsWith("/api/attempts/") && session === null) return error(401, "UNAUTHENTICATED");
        if (route === `GET /api/attempts/${attempt}/signing-payload`) {
          const change = moveOn;
          moveOn = null;
          if (change) await install(change(room));
          return json(200, { data: payload });
        }
        if (route === `POST /api/attempts/${room.attempt?.id}/refresh`) return json(200, { data: room.attempt });
        if (route === `POST /api/attempts/${attempt}/signatures`) {
          const wallet = session!.wallet;
          if (body.messageHash !== payment.wirePayload.messageHash || !isCanonical64(body.signatureBase64)) return error(400, "INVALID_SIGNATURE");
          try {
            await verifyPayerSignature(payment.validated, { wallet: address(wallet), signatureBytes: Buffer.from(body.signatureBase64, "base64") });
          } catch {
            return error(400, "INVALID_SIGNATURE");
          }
          uploads.push({ wallet, body: sent.postDataJSON() });
          const signedWallets = [...new Set([...room.attempt!.signedWallets, wallet])];
          await install({ ...room, attempt: { ...room.attempt!, signedWallets } });
          return json(200, { data: room.attempt });
        }
        return null;
      };
    },
  };
}
