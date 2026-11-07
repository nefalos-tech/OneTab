import { beforeEach, describe, expect, it, vi } from "vitest";

const { setReadiness } = vi.hoisted(() => ({ setReadiness: vi.fn() }));
vi.mock("@/server/auth/service", () => ({ requireWalletSession: async () => ({ ok: true, value: { wallet: "member-wallet", expiresAt: "later" } }) }));
vi.mock("@/server/rooms/service", () => ({
  isReadyBody: (value: unknown): value is { ready: boolean } => typeof value === "object" && value !== null && "ready" in value && typeof value.ready === "boolean",
  parseRoomId: (value: string) => value,
  requestOriginAllowed: (request: Request) => request.headers.get("origin") === "http://localhost:3000",
  setReadiness,
}));

import { PUT } from "./route";

describe("checkout readiness route", () => {
  beforeEach(() => setReadiness.mockReset());

  it("changes readiness only for the session wallet", async () => {
    const room = { checkout: { id: "checkout" }, participants: [], phase: "open", attempt: null };
    setReadiness.mockResolvedValue({ ok: true, value: room });
    const response = await PUT(new Request("http://localhost:3000/api/checkouts/room-id/readiness", {
      method: "PUT", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ ready: true, wallet: "attacker-wallet" }),
    }), { params: Promise.resolve({ id: "room-id" }) });

    expect(response.status).toBe(200);
    expect(setReadiness).toHaveBeenCalledWith("room-id", "member-wallet", true);
  });
});
