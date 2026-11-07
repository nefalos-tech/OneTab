import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const checkoutId = "00000000-0000-4000-8000-000000000001";

describe("public checkout snapshot route", () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.SUPABASE_URL = "https://database.example.test";
    process.env.SUPABASE_SECRET_KEY = "test-only-secret";
  });

  it("returns a public snapshot without caching it", async () => {
    const data = { checkout: { id: checkoutId, title: "Lunch", organizerWallet: "11111111111111111111111111111111", sellerWallet: "22222222222222222222222222222222", network: "devnet", mint: "22222222222222222222222222222222", tokenDecimals: 6, totalUnits: "10", payerCount: 2, createdAt: new Date().toISOString() }, participants: [], phase: "open", attempt: null };
    const fetch = vi.fn(async () => Response.json(data));
    vi.stubGlobal("fetch", fetch);

    const response = await GET(new Request(`http://localhost:3000/api/checkouts/${checkoutId}`), { params: Promise.resolve({ id: checkoutId }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not query the database for malformed room IDs", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const response = await GET(new Request("http://localhost:3000/api/checkouts/not-a-uuid"), { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
