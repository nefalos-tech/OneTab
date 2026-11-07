import { describe, expect, it } from "vitest";
import { send, type FetchLike } from "./api";

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
