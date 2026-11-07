import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

export const FAKE_API = { empty: "http://localhost:3198", rooms: "http://localhost:3199" };

export const CONFIG = {
  network: "devnet",
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  tokenDecimals: 6,
  confirmationTarget: "finalized",
};

export const WALLETS = {
  ava: "MASi45ub7Qe4ZE36UT5G6cU4ud8Fhhe4deS4F3cw9KTA",
  ben: "b8dLcukC7edhDQ7cn5d4gEYkbUrMWeWQLGsCmrG6dLaY",
  cleo: "yNoVKf58ZTBqNAYT3j5qcdsyuMNmPfYetW5v6JXmj54o",
  shop: "mLidkuVKnRyjP2WPBg8Y4ErK9pGSSxY6BVScJy9uUxcJ",
};

export const LIVE = {
  open: "0b8f3c1e-7d2a-4c55-9f10-2a6b8e4d1c01",
  full: "0b8f3c1e-7d2a-4c55-9f10-2a6b8e4d1c02",
  outage: "0b8f3c1e-7d2a-4c55-9f10-2a6b8e4d1c03",
  noRoute: "0b8f3c1e-7d2a-4c55-9f10-2a6b8e4d1c04",
  missing: "0b8f3c1e-7d2a-4c55-9f10-2a6b8e4d1c06",
};

const COUNTED_PREFIX = "c0c0c0c0-";

/** A room no earlier run has read, so a repeated or retried test counts its reads from zero. */
export const freshCountedRoom = () => `${COUNTED_PREFIX}${randomUUID().slice(COUNTED_PREFIX.length)}`;

const checkout = (id, fields) => ({
  id,
  network: "devnet",
  mint: CONFIG.mint,
  tokenDecimals: CONFIG.tokenDecimals,
  sellerWallet: WALLETS.shop,
  createdAt: "2026-11-07T10:00:00.000Z",
  ...fields,
});

const cabin = (id) => ({
  checkout: checkout(id, { title: "Cabin groceries", organizerWallet: WALLETS.ava, totalUnits: "30000000", payerCount: 3 }),
  participants: [{ slot: 0, wallet: WALLETS.ava, shareUnits: "10000000", ready: false }],
  phase: "open",
  attempt: null,
});

export const ROOMS = {
  [LIVE.open]: cabin(LIVE.open),
  [LIVE.full]: {
    checkout: checkout(LIVE.full, { title: "Concert tickets", organizerWallet: WALLETS.ben, totalUnits: "45000000", payerCount: 2 }),
    participants: [
      { slot: 0, wallet: WALLETS.ben, shareUnits: "22500000", ready: true },
      { slot: 1, wallet: WALLETS.cleo, shareUnits: "22500000", ready: false },
    ],
    phase: "open",
    attempt: null,
  },
};

const SCRIPTED_PREFIX = "5c5c5c5c-";

export const scriptedRoom = () => `${SCRIPTED_PREFIX}${randomUUID().slice(SCRIPTED_PREFIX.length)}`;
export const nextStep = (id) => `${FAKE_API.rooms}/__script/${id}/step`;

const PARTY = [WALLETS.ava, WALLETS.ben, WALLETS.cleo];

const party = (id) => ({
  checkout: checkout(id, { title: "Weekend cabin", organizerWallet: WALLETS.ava, totalUnits: "90000000", payerCount: 3 }),
  participants: PARTY.map((wallet, slot) => ({ slot, wallet, shareUnits: "30000000", ready: true })),
});

const attempt = (id, state, signedWallets) => ({
  id: `a7${id.slice(2)}`,
  state,
  signedWallets,
  transactionReference: null,
  lastValidBlockHeight: state === "preparing" ? null : "312345678",
  error: null,
  canRetry: false,
  receipt: null,
});

export const SCRIPT = [
  (id) => ({ ...party(id), phase: "open", attempt: null, participants: party(id).participants.map((p) => ({ ...p, ready: p.slot === 0 })) }),
  (id) => ({ ...party(id), phase: "ready", attempt: null }),
  (id) => ({ ...party(id), phase: "paying", attempt: attempt(id, "preparing", []) }),
  (id) => ({ ...party(id), phase: "paying", attempt: attempt(id, "signing", [WALLETS.cleo]) }),
  (id) => ({ ...party(id), phase: "paying", attempt: attempt(id, "signing", [WALLETS.cleo, WALLETS.ava]) }),
  (id) => ({ ...party(id), phase: "paying", attempt: attempt(id, "submitting", [WALLETS.cleo, WALLETS.ava, WALLETS.ben]) }),
];

const json = (status, body) => ({ status, type: "application/json", body: JSON.stringify(body) });
const error = (status, code) => json(status, { error: { code, message: "Shown nowhere." } });
const html404 = { status: 404, type: "text/html", body: "<h1>Not found</h1>" };

export const browserRead = (origin, id) => `${origin}/__rooms/${id}`;

function respond(dataset, { reads, steps }, method, path) {
  const counted = /^\/__reads\/([0-9a-f-]{36})$/.exec(path);
  if (method === "GET" && counted) return json(200, { count: reads.get(counted[1]) ?? 0 });
  const advance = /^\/__script\/(5c5c5c5c-[0-9a-f-]{27})\/step$/.exec(path);
  if (method === "POST" && advance) {
    const step = Math.min((steps.get(advance[1]) ?? 0) + 1, SCRIPT.length - 1);
    steps.set(advance[1], step);
    return json(200, { step });
  }
  if (method === "GET" && path === "/api/config") {
    return dataset === "rooms" ? json(200, { data: CONFIG }) : error(503, "CONFIGURATION_UNAVAILABLE");
  }
  const room = /^\/(api\/checkouts|__rooms)\/([0-9a-fA-F-]{36})$/.exec(path);
  if (method !== "GET" || !room) return html404;
  // Like Backend's uuid column, any case finds the room, and the answer carries the lowercase ID.
  const id = room[2].toLowerCase();
  if (room[1] === "api/checkouts") reads.set(id, (reads.get(id) ?? 0) + 1);
  if (dataset === "rooms" && id === LIVE.outage) return error(503, "CONFIGURATION_UNAVAILABLE");
  if (dataset === "rooms" && id === LIVE.noRoute) return html404;
  if (dataset === "rooms" && id.startsWith(COUNTED_PREFIX)) return json(200, { data: cabin(id) });
  if (dataset === "rooms" && id.startsWith(SCRIPTED_PREFIX)) return json(200, { data: SCRIPT[steps.get(id) ?? 0](id) });
  const snapshot = dataset === "rooms" ? ROOMS[id] : undefined;
  return snapshot ? json(200, { data: snapshot }) : error(404, "CHECKOUT_NOT_FOUND");
}

export function serve() {
  for (const [dataset, origin] of Object.entries(FAKE_API)) {
    const state = { reads: new Map(), steps: new Map() };
    createServer((req, res) => {
      const { status, type, body } = respond(dataset, state, req.method, new URL(req.url ?? "/", origin).pathname);
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(body);
    }).listen(Number(new URL(origin).port));
  }
}
