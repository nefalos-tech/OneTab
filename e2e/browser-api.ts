import { expect, test as base, type BrowserContext, type Page, type Request } from "@playwright/test";
import { FAKE_API, browserRead } from "./fake-api.mjs";

const ROOM_READ = /^\/api\/checkouts\/([0-9a-fA-F-]{36})$/;

export type Answer = { readonly status: number; readonly body: unknown };

/** Answers one context's same-origin /api request in Node, or null to leave it to the guard. */
export type Backend = (request: Request, url: URL) => Promise<Answer | null>;

export type BrowserApi = {
  newPage(): Promise<Page>;
  /** Lets `backend` answer `context`'s requests first. What it leaves is a room read or a stray, as before. */
  answer(context: BrowserContext, backend: Backend): void;
};

export const test = base.extend<{ fakeApi: string; browserApi: BrowserApi }>({
  fakeApi: [FAKE_API.rooms, { option: true }],
  browserApi: [
    async ({ browser, context, baseURL, viewport, fakeApi }, use) => {
      const strays: string[] = [];
      const sent: Request[] = [];
      const answered = new Set<Request>();
      const backends = new Map<BrowserContext, Backend>();
      const guard = async (guarded: BrowserContext) => {
        guarded.on("request", (request) => {
          if (request.method() !== "GET") sent.push(request);
        });
        await guarded.route("**/api/**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const sameOrigin = url.origin === new URL(baseURL!).origin;
          const answer = sameOrigin ? await backends.get(guarded)?.(request, url) : null;
          if (answer) {
            answered.add(request);
            return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
          }
          const room = ROOM_READ.exec(url.pathname);
          if (request.method() !== "GET" || !sameOrigin || !room) {
            strays.push(`${request.method()} ${request.url()}`);
            return route.abort();
          }
          const read = await fetch(browserRead(fakeApi, room[1]!));
          return route.fulfill({ status: read.status, contentType: "application/json", body: await read.text() });
        });
      };
      const others: BrowserContext[] = [];
      await guard(context);
      await use({
        async newPage() {
          const other = await browser.newContext({ baseURL, viewport });
          others.push(other);
          await guard(other);
          return other.newPage();
        },
        answer(guarded, backend) {
          backends.set(guarded, backend);
        },
      });
      for (const guarded of [context, ...others]) await guarded.unrouteAll({ behavior: "ignoreErrors" });
      for (const other of others) await other.close();
      for (const request of sent) if (!answered.has(request)) strays.push(`${request.method()} ${request.url()}`);
      expect([...new Set(strays)], "a page sent a request that neither a room read nor the test's backend answered").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
