import { isCheckoutId, type CheckoutId, type RoomSnapshot, type Session } from "./contracts";
import { SITUATIONS, type Screen, type Situation } from "./catalog";
import { checkoutLinks, spotNumber, type CheckoutState, type CreateState, type ScreenLinks } from "./checkout-view";
import { SAMPLE_CONFIG, SAMPLE_SESSION_EXPIRY, SAMPLE_WALLETS, SNAPSHOTS, type SampleName } from "./fixture-data";
import type { SampleWalletSeed } from "@/lib/wallet/sample";

export type Persona =
  | { readonly kind: "member"; readonly slot: number }
  | { readonly kind: "outsider" }
  | { readonly kind: "signed_out" };

type FixtureEntry = {
  readonly label: string;
  readonly situation: Situation;
  readonly snapshot: RoomSnapshot;
  readonly defaultPersona: Persona;
};

const ORGANIZER: Persona = { kind: "member", slot: 0 };
const SPOT_2: Persona = { kind: "member", slot: 1 };
const SPOT_3: Persona = { kind: "member", slot: 2 };

export const FIXTURES = {
  "open-spots": {
    label: "Open spots",
    situation: "open_spots",
    snapshot: SNAPSHOTS["open-spots"],
    defaultPersona: ORGANIZER,
  },
  "full-not-ready": {
    label: "Full, not everyone ready",
    situation: "full_not_ready",
    snapshot: SNAPSHOTS["full-not-ready"],
    defaultPersona: SPOT_3,
  },
  ready: { label: "Everyone ready", situation: "ready", snapshot: SNAPSHOTS.ready, defaultPersona: ORGANIZER },
  preparing: { label: "Preparing", situation: "preparing", snapshot: SNAPSHOTS.preparing, defaultPersona: SPOT_2 },
  signing: {
    label: "Collecting approvals",
    situation: "signing",
    snapshot: SNAPSHOTS.signing,
    defaultPersona: SPOT_2,
  },
  submitting: {
    label: "Sending",
    situation: "submitting",
    snapshot: SNAPSHOTS.submitting,
    defaultPersona: ORGANIZER,
  },
  confirming: {
    label: "Accepted, receipt pending",
    situation: "confirming",
    snapshot: SNAPSHOTS.confirming,
    defaultPersona: ORGANIZER,
  },
  unresolved: {
    label: "Result unknown",
    situation: "unresolved",
    snapshot: SNAPSHOTS.unresolved,
    defaultPersona: ORGANIZER,
  },
  "declined-on-hold": {
    label: "Declined, on hold",
    situation: "declined",
    snapshot: SNAPSHOTS["declined-on-hold"],
    defaultPersona: ORGANIZER,
  },
  "declined-retry": {
    label: "Declined, organizer can try again",
    situation: "declined",
    snapshot: SNAPSHOTS["declined-retry"],
    defaultPersona: ORGANIZER,
  },
  "failed-on-hold": {
    label: "Failed, on hold",
    situation: "failed",
    snapshot: SNAPSHOTS["failed-on-hold"],
    defaultPersona: ORGANIZER,
  },
  "failed-retry": {
    label: "Failed, organizer can try again",
    situation: "failed",
    snapshot: SNAPSHOTS["failed-retry"],
    defaultPersona: ORGANIZER,
  },
  "expired-on-hold": {
    label: "Approval window ended, on hold",
    situation: "expired",
    snapshot: SNAPSHOTS["expired-on-hold"],
    defaultPersona: SPOT_2,
  },
  "expired-retry": {
    label: "Approval window ended, organizer can try again",
    situation: "expired",
    snapshot: SNAPSHOTS["expired-retry"],
    defaultPersona: ORGANIZER,
  },
  paid: { label: "Paid with receipt", situation: "paid", snapshot: SNAPSHOTS.paid, defaultPersona: SPOT_2 },
} as const satisfies Record<SampleName, FixtureEntry>;
export type FixtureName = keyof typeof FIXTURES;

const SAMPLE_PREFIX = "sample-";
const OPEN_ROOM: FixtureName = "open-spots";

export type SampleRef = { readonly kind: "sample"; readonly fixture: FixtureName; readonly persona: Persona };
export type CheckoutRef = SampleRef | { readonly kind: "live"; readonly checkoutId: CheckoutId };

export function parseFixtureFlag(flag: string | undefined, nodeEnv: string | undefined): boolean {
  if (flag === "1") return true;
  if (flag === "0") return false;
  if (flag === undefined || flag === "") return nodeEnv === "development";
  throw new Error(`ONETAB_FIXTURES must be "1", "0" or unset. Got "${flag}".`);
}

export function parseCheckoutRef(input: {
  readonly id: string;
  readonly as: string | readonly string[] | undefined;
  readonly fixturesOn: boolean;
}): CheckoutRef | null {
  if (isCheckoutId(input.id)) return { kind: "live", checkoutId: input.id };
  if (!input.fixturesOn || !input.id.startsWith(SAMPLE_PREFIX)) return null;
  const name = input.id.slice(SAMPLE_PREFIX.length);
  if (!isFixtureName(name) || typeof input.as === "object") return null;
  const persona = input.as === undefined ? FIXTURES[name].defaultPersona : parsePersona(input.as);
  if (persona === null || !personasFor(FIXTURES[name].snapshot).some((p) => samePersona(p, persona))) return null;
  return { kind: "sample", fixture: name, persona };
}

export function personaParam(persona: Persona): string {
  switch (persona.kind) {
    case "member":
      return `spot-${spotNumber(persona.slot)}`;
    case "outsider":
      return "outsider";
    case "signed_out":
      return "signed-out";
  }
}

export function sampleCheckoutState(ref: SampleRef): CheckoutState {
  const entry = FIXTURES[ref.fixture];
  const { snapshot } = entry;
  const session = sessionFor(ref.persona, snapshot);
  return {
    config: SAMPLE_CONFIG,
    snapshot,
    session,
    source: {
      kind: "sample",
      fixtureLabel: entry.label,
      links: sampleLinks(ref.fixture, ref.persona),
      personas: personasFor(snapshot).map((p) => ({
        label: personaLabel(p),
        links: sampleLinks(ref.fixture, p),
        current: samePersona(p, ref.persona),
      })),
      wallet: sampleWalletSeed(session),
    },
  };
}

export function sampleCreateState(): CreateState {
  const session = { wallet: SAMPLE_WALLETS.organizer, expiresAt: SAMPLE_SESSION_EXPIRY };
  return {
    config: SAMPLE_CONFIG,
    session,
    source: { kind: "sample", sampleRoomHref: sampleLinks(OPEN_ROOM, ORGANIZER).room, wallet: sampleWalletSeed(session) },
  };
}

/** The sample wallet's accounts. It starts on the persona's wallet, or on the outsider when signed out. */
function sampleWalletSeed(session: Session | null): SampleWalletSeed {
  return {
    accounts: [
      { label: "Organizer", wallet: SAMPLE_WALLETS.organizer },
      { label: "Bea", wallet: SAMPLE_WALLETS.bea },
      { label: "Cam", wallet: SAMPLE_WALLETS.cam },
      { label: "Someone with the link", wallet: SAMPLE_WALLETS.outsider },
    ],
    selected: session?.wallet ?? SAMPLE_WALLETS.outsider,
  };
}

export type FixtureCase = {
  readonly fixture: FixtureName;
  readonly persona: Persona;
  readonly id: string;
  readonly situation: Situation;
  readonly state: CheckoutState;
};

export function fixtureCases(): readonly FixtureCase[] {
  return fixtureNames().flatMap((fixture) =>
    personasFor(FIXTURES[fixture].snapshot).map((persona) => ({
      fixture,
      persona,
      id: `${fixture} as ${personaParam(persona)}`,
      situation: FIXTURES[fixture].situation,
      state: sampleCheckoutState({ kind: "sample", fixture, persona }),
    })),
  );
}

export type SampleIndexEntry = {
  readonly fixture: FixtureName;
  readonly label: string;
  readonly situation: Situation;
  readonly owner: Screen;
  readonly personas: readonly { readonly label: string; readonly links: ScreenLinks; readonly isDefault: boolean }[];
};

export function sampleIndex(): readonly SampleIndexEntry[] {
  return fixtureNames().map((fixture) => {
    const entry = FIXTURES[fixture];
    return {
      fixture,
      label: entry.label,
      situation: entry.situation,
      owner: SITUATIONS[entry.situation].owner,
      personas: personasFor(entry.snapshot).map((p) => ({
        label: personaLabel(p),
        links: sampleLinks(fixture, p),
        isDefault: samePersona(p, entry.defaultPersona),
      })),
    };
  });
}

function fixtureNames(): readonly FixtureName[] {
  return Object.keys(FIXTURES).filter(isFixtureName);
}

function sampleLinks(fixture: FixtureName, persona: Persona): ScreenLinks {
  return checkoutLinks(`${SAMPLE_PREFIX}${fixture}`, `?as=${personaParam(persona)}`);
}

function personasFor(snapshot: RoomSnapshot): readonly Persona[] {
  return [
    ...snapshot.participants.map((p): Persona => ({ kind: "member", slot: p.slot })),
    { kind: "outsider" },
    { kind: "signed_out" },
  ];
}

function sessionFor(persona: Persona, snapshot: RoomSnapshot): Session | null {
  switch (persona.kind) {
    case "member": {
      const spot = snapshot.participants.find((p) => p.slot === persona.slot);
      if (!spot) throw new Error(`Sample has no payer in slot ${persona.slot}`);
      return { wallet: spot.wallet, expiresAt: SAMPLE_SESSION_EXPIRY };
    }
    case "outsider":
      return { wallet: SAMPLE_WALLETS.outsider, expiresAt: SAMPLE_SESSION_EXPIRY };
    case "signed_out":
      return null;
  }
}

function personaLabel(persona: Persona): string {
  switch (persona.kind) {
    case "member":
      return persona.slot === 0 ? "Spot 1 (organizer)" : `Spot ${spotNumber(persona.slot)}`;
    case "outsider":
      return "Someone with the link";
    case "signed_out":
      return "Signed out";
  }
}

function isFixtureName(name: string): name is FixtureName {
  return Object.hasOwn(FIXTURES, name);
}

function parsePersona(param: string): Persona | null {
  if (param === "outsider") return { kind: "outsider" };
  if (param === "signed-out") return { kind: "signed_out" };
  const spot = /^spot-([1-3])$/.exec(param);
  return spot ? { kind: "member", slot: Number(spot[1]) - 1 } : null;
}

function samePersona(a: Persona, b: Persona): boolean {
  return a.kind === b.kind && (a.kind !== "member" || (b.kind === "member" && a.slot === b.slot));
}
