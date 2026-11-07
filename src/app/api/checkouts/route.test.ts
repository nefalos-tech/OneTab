import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRoom } = vi.hoisted(() => ({ createRoom: vi.fn() }));
vi.mock("@/server/auth/service", () => ({ requireWalletSession: async () => ({ ok: true, value: { wallet: "organizer-wallet", expiresAt: "later" } }) }));
vi.mock("@/server/rooms/service", () => ({
  createRoom,
  requestOriginAllowed: (request: Request) => request.headers.get("origin") === "http://localhost:3000",
}));

import { POST } from "./route";

describe("create checkout route", () => {
  beforeEach(() => createRoom.mockReset());

  it("uses the authenticated wallet and returns the created room without caching", async () => {
    const room = { checkout: { id: "checkout" }, participants: [], phase: "open", attempt: null };
    createRoom.mockResolvedValue({ ok: true, value: room });
    const response = await POST(new Request("http://localhost:3000/api/checkouts", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ title: "Lunch", organizerWallet: "attacker", sellerWallet: "seller", totalUnits: "10", payerCount: 2, clientRequestId: "id" }),
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: room });
    expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ organizerWallet: "attacker" }), "organizer-wallet");
  });

  it("rejects another origin before creating a room", async () => {
    const response = await POST(new Request("http://localhost:3000/api/checkouts", {
      method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(createRoom).not.toHaveBeenCalled();
  });
});
