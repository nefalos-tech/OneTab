import { expect, test as base } from "@playwright/test";
import { FAKE_API, browserRead } from "./fake-api.mjs";

const ROOM_READ = /^\/api\/checkouts\/([0-9a-fA-F-]{36})$/;

/**
 * Answers each page's room polls from the fake API that the server reads, so the server render and the
 * polled room agree. Any other browser request to /api, and any request that isn't a GET, fails the
 * test: until P1 signs a payer in, a live page sends nothing but room reads.
 */
export const test = base.extend<{ fakeApi: string; browserApi: void }>({
  fakeApi: [FAKE_API.rooms, { option: true }],
  browserApi: [
    async ({ context, baseURL, fakeApi }, use) => {
      const strays: string[] = [];
      context.on("request", (request) => {
        if (request.method() !== "GET") strays.push(`${request.method()} ${request.url()}`);
      });
      await context.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const room = ROOM_READ.exec(url.pathname);
        if (request.method() !== "GET" || url.origin !== new URL(baseURL!).origin || !room) {
          strays.push(`${request.method()} ${request.url()}`);
          return route.abort();
        }
        const answer = await fetch(browserRead(fakeApi, room[1]!));
        return route.fulfill({ status: answer.status, contentType: "application/json", body: await answer.text() });
      });
      await use();
      await context.unrouteAll({ behavior: "ignoreErrors" });
      expect(strays, "a page sent a request other than a room read").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
