import { beforeEach, describe, expect, it, vi } from "vitest";

const { joinRoom } = vi.hoisted(() => ({ joinRoom: vi.fn() }));
vi.mock("@/server/auth/service", () => ({ requireWalletSession: async () => ({ ok: true, value: { wallet: "payer-wallet", expiresAt: "later" } }) }));
vi.mock("@/server/rooms/service", () => ({
  joinRoom,
  parseRoomId: (value: string) => value,
  requestOriginAllowed: (request: Request) => request.headers.get("origin") === "http://localhost:3000",
}));

import { POST } from "./route";

describe("join checkout route", () => {
  beforeEach(() => joinRoom.mockReset());

  it("joins as the session wallet, without accepting a wallet from the request", async () => {
    const room = { checkout: { id: "checkout" }, participants: [], phase: "open", attempt: null };
    joinRoom.mockResolvedValue({ ok: true, value: room });
    const response = await POST(new Request("http://localhost:3000/api/checkouts/room-id/join", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ wallet: "attacker-wallet" }),
    }), { params: Promise.resolve({ id: "room-id" }) });

    expect(response.status).toBe(200);
    expect(joinRoom).toHaveBeenCalledWith("room-id", "payer-wallet");
  });

  it("rejects another origin before claiming a slot", async () => {
    const response = await POST(new Request("http://localhost:3000/api/checkouts/room-id/join", { method: "POST", headers: { origin: "https://attacker.example" } }), { params: Promise.resolve({ id: "room-id" }) });

    expect(response.status).toBe(403);
    expect(joinRoom).not.toHaveBeenCalled();
  });
});
