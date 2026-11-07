import { describe, expect, it } from "vitest";
import { apiOrigin, checkoutApi, originFetch, send, type FetchLike } from "./api";
import type { ClientRequestId } from "./contracts";
import { SAMPLE_CONFIG } from "./fixture-data";
import { FIXTURES } from "./fixtures";

type Call = { readonly path: string; readonly init: RequestInit };

function stubFetch(respond: (call: Call) => Response | Promise<Response>): { readonly fetch: FetchLike; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (path, init) => {
      const call = { path, init };
      calls.push(call);
      return respond(call);
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errorBody = (code: string) => ({ error: { code, message: "Something the browser never shows." } });
const html404 = () => new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } });

describe("send", () => {
  it("sends the same-origin cookie, no-store, no redirects, a timeout, and JSON only when there is a body", async () => {
    const { fetch, calls } = stubFetch(() => json(200, { data: null }));
    await send(fetch, "POST", "/api/checkouts", { title: "Cabin" });
    await send(fetch, "GET", "/api/config");

    expect(calls.map((c) => [c.init.method, c.path, c.init.body ?? null, c.init.headers ?? null])).toEqual([
      ["POST", "/api/checkouts", JSON.stringify({ title: "Cabin" }), { "content-type": "application/json" }],
      ["GET", "/api/config", null, null],
    ]);
    for (const { init } of calls) {
      expect(init.credentials).toBe("same-origin");
      expect(init.cache).toBe("no-store");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reads 200 and 201 with a data envelope as data", async () => {
    const read = (response: Response) => send(stubFetch(() => response).fetch, "GET", "/api/x");
    expect(await read(json(200, { data: { a: 1 } }))).toEqual({ kind: "data", data: { a: 1 } });
    expect(await read(json(201, { data: { a: 1 } }))).toEqual({ kind: "data", data: { a: 1 } });
    expect(await read(json(200, { data: null }))).toEqual({ kind: "data", data: null });
  });

  it("keeps a known error code and its status, and never the message", async () => {
    const read = (response: Response) => send(stubFetch(() => response).fetch, "GET", "/api/x");
    expect(await read(json(404, errorBody("CHECKOUT_NOT_FOUND")))).toEqual({ kind: "error", status: 404, code: "CHECKOUT_NOT_FOUND" });
    expect(await read(json(409, errorBody("ROOM_FULL")))).toEqual({ kind: "error", status: 409, code: "ROOM_FULL" });
  });

  it("reads a bare 404, an unknown code and a success without data as an error with no code", async () => {
    const read = (response: Response) => send(stubFetch(() => response).fetch, "GET", "/api/x");
    expect(await read(html404())).toEqual({ kind: "error", status: 404, code: null });
    expect(await read(json(500, errorBody("SOMETHING_NEW")))).toEqual({ kind: "error", status: 500, code: null });
    expect(await read(json(200, { checkout: {} }))).toEqual({ kind: "error", status: 200, code: null });
    expect(await read(json(202, { data: {} }))).toEqual({ kind: "error", status: 202, code: null });
  });

  it("reads a network error, a refused redirect and a timeout as no answer", async () => {
    for (const failure of [
      new TypeError("fetch failed"),
      new TypeError("unexpected redirect"),
      new DOMException("The operation timed out.", "TimeoutError"),
    ]) {
      const reply = await send(stubFetch(() => Promise.reject(failure)).fetch, "POST", "/api/x");
      expect(reply, failure.message).toEqual({ kind: "no_answer" });
    }
  });
});

const ROOM = FIXTURES["open-spots"].snapshot;
const ID = ROOM.checkout.id;
const api = (respond: (call: Call) => Response | Promise<Response>) => checkoutApi(stubFetch(respond).fetch);

describe("checkoutApi reads", () => {
  it("reads the room at its contract path", async () => {
    const { fetch, calls } = stubFetch(() => json(200, { data: ROOM }));
    expect(await checkoutApi(fetch).readRoom(ID)).toEqual({ ok: true, value: ROOM });
    expect(calls.map((c) => [c.init.method, c.path])).toEqual([["GET", `/api/checkouts/${ID}`]]);
  });

  it("calls a room missing only when the server says CHECKOUT_NOT_FOUND", async () => {
    expect(await api(() => json(404, errorBody("CHECKOUT_NOT_FOUND"))).readRoom(ID)).toEqual({ ok: false, failure: "not_found" });
    expect(await api(html404).readRoom(ID)).toEqual({ ok: false, failure: "unavailable" });
  });

  it("reads an outage, rate limiting and no answer as unavailable", async () => {
    for (const respond of [
      () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")),
      () => json(429, errorBody("RATE_LIMITED")),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      expect(await api(respond).readRoom(ID)).toEqual({ ok: false, failure: "unavailable" });
    }
  });

  it("refuses a snapshot of another checkout or one that doesn't parse", async () => {
    const other = FIXTURES.paid.snapshot;
    expect(await api(() => json(200, { data: other })).readRoom(ID)).toEqual({ ok: false, failure: "unavailable" });
    expect(await api(() => json(200, { data: { ...ROOM, phase: "closed" } })).readRoom(ID)).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });

  it("reads the configuration, and anything else as unavailable", async () => {
    const { fetch, calls } = stubFetch(() => json(200, { data: SAMPLE_CONFIG }));
    expect(await checkoutApi(fetch).readConfig()).toEqual({ ok: true, value: SAMPLE_CONFIG });
    expect(calls.map((c) => [c.init.method, c.path])).toEqual([["GET", "/api/config"]]);
    expect(await api(() => json(503, errorBody("CONFIGURATION_UNAVAILABLE"))).readConfig()).toEqual({ ok: false, failure: "unavailable" });
    expect(await api(() => json(200, { data: { ...SAMPLE_CONFIG, network: "mainnet-beta" } })).readConfig()).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });
});

describe("the server's API origin", () => {
  it("prefers ONETAB_API_ORIGIN, then APP_ORIGIN", () => {
    expect(apiOrigin({ ONETAB_API_ORIGIN: "http://localhost:3199", APP_ORIGIN: "https://onetab.example" })).toBe("http://localhost:3199");
    expect(apiOrigin({ APP_ORIGIN: "https://onetab.example/" })).toBe("https://onetab.example");
    expect(apiOrigin({ ONETAB_API_ORIGIN: "", APP_ORIGIN: "https://onetab.example" })).toBe("https://onetab.example");
  });

  it.each(["", "onetab.example", "https://onetab.example/api", "https://onetab.example?x=1", "file:///etc", "ftp://onetab.example"])(
    "refuses %j",
    (value) => {
      expect(apiOrigin({ ONETAB_API_ORIGIN: value })).toBeNull();
    },
  );

  it("resolves each contract path against the configured origin and nothing else", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: URL) => {
      urls.push(input.href);
      return json(200, { data: ROOM });
    }) as typeof fetch;
    const room = await checkoutApi(originFetch({ ONETAB_API_ORIGIN: "http://localhost:3199" }, fetchImpl)).readRoom(ID);
    expect(room.ok).toBe(true);
    expect(urls).toEqual([`http://localhost:3199/api/checkouts/${ID}`]);

    const escape = originFetch({ ONETAB_API_ORIGIN: "http://localhost:3199" }, fetchImpl);
    expect(await send(escape, "GET", "//attacker.example/api/config")).toEqual({ kind: "no_answer" });
    expect(urls).toHaveLength(1);
  });

  it("with no origin sends nothing, and the room reads as unavailable", async () => {
    let sent = 0;
    const fetchImpl = (async () => {
      sent += 1;
      return json(200, { data: ROOM });
    }) as typeof fetch;
    expect(await checkoutApi(originFetch({}, fetchImpl)).readRoom(ID)).toEqual({ ok: false, failure: "unavailable" });
    expect(sent).toBe(0);
  });
});

const REQUEST = {
  title: "Cabin weekend groceries",
  sellerWallet: ROOM.checkout.sellerWallet,
  totalUnits: ROOM.checkout.totalUnits,
  payerCount: ROOM.checkout.payerCount,
};
const REQUEST_ID = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b" as ClientRequestId;

describe("checkoutApi create and join", () => {
  it("posts exactly the contract's create body, and reads 201 as the new room", async () => {
    const { fetch, calls } = stubFetch(() => json(201, { data: ROOM }));
    expect(await checkoutApi(fetch).create({ ...REQUEST, extra: "never sent" } as typeof REQUEST, REQUEST_ID)).toEqual({
      ok: true,
      value: ROOM,
    });
    expect(calls.map((c) => [c.init.method, c.path, JSON.parse(String(c.init.body))])).toEqual([
      ["POST", "/api/checkouts", { ...REQUEST, clientRequestId: REQUEST_ID }],
    ]);
  });

  it("posts a join with no body to the checkout's join path", async () => {
    const { fetch, calls } = stubFetch(() => json(200, { data: ROOM }));
    expect(await checkoutApi(fetch).join(ID)).toEqual({ ok: true, value: ROOM });
    expect(calls.map((c) => [c.init.method, c.path, c.init.body ?? null])).toEqual([["POST", `/api/checkouts/${ID}/join`, null]]);
  });

  it("refuses a join that answers with another checkout", async () => {
    expect(await api(() => json(200, { data: FIXTURES.paid.snapshot })).join(ID)).toEqual({ ok: false, failure: "unavailable" });
  });

  it.each<[string, () => Response]>([
    ["no body", () => new Response(null, { status: 401 })],
    ["an HTML body", () => new Response("<html>Sign in</html>", { status: 401, headers: { "content-type": "text/html" } })],
    ["empty JSON", () => json(401, {})],
    ["the error envelope", () => json(401, errorBody("UNAUTHENTICATED"))],
  ])("reads a 401 with %s on create and join as signed_out", async (_, respond) => {
    expect(await api(respond).create(REQUEST, REQUEST_ID)).toEqual({ ok: false, failure: "signed_out" });
    expect(await api(respond).join(ID)).toEqual({ ok: false, failure: "signed_out" });
  });

  it.each<[string, () => Response | Promise<Response>, string]>([
    ["ROOM_FULL", () => json(409, errorBody("ROOM_FULL")), "room_full"],
    ["RATE_LIMITED", () => json(429, errorBody("RATE_LIMITED")), "rate_limited"],
    ["INVALID_INPUT", () => json(400, errorBody("INVALID_INPUT")), "refused"],
    ["FORBIDDEN", () => json(403, errorBody("FORBIDDEN")), "refused"],
    ["ORIGIN_MISMATCH", () => json(403, errorBody("ORIGIN_MISMATCH")), "refused"],
    ["IDEMPOTENCY_CONFLICT", () => json(409, errorBody("IDEMPOTENCY_CONFLICT")), "refused"],
    ["CHECKOUT_NOT_FOUND", () => json(404, errorBody("CHECKOUT_NOT_FOUND")), "refused"],
    ["CHECKOUT_PAID", () => json(409, errorBody("CHECKOUT_PAID")), "refused"],
    ["CONFIGURATION_UNAVAILABLE", () => json(503, errorBody("CONFIGURATION_UNAVAILABLE")), "unavailable"],
    ["an unexpected code", () => json(422, errorBody("INSUFFICIENT_SOL")), "unavailable"],
    ["a bare 404", html404, "unavailable"],
    ["no answer", () => Promise.reject(new TypeError("fetch failed")), "unavailable"],
  ])("reads %s on create and join as %s", async (_, respond, failure) => {
    expect(await api(respond).create(REQUEST, REQUEST_ID)).toEqual({ ok: false, failure });
    expect(await api(respond).join(ID)).toEqual({ ok: false, failure });
  });
});
