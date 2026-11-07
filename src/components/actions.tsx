"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ACTIONS, WORDS, type ActionKind } from "@/client/catalog";
import { busyShown, noticeApplies, type Action, type ActionsView, type Notice } from "@/client/checkout-view";
import { isLiveAction, live, untracked, type LiveAction, type LiveKind, type Track } from "@/client/live-actions";
import { BUTTON } from "./button";
import { Icon } from "./icon";
import { useWalletSession } from "./wallet/wallet-scope";

export const RoomTrack = createContext<Track>(untracked);

export function ActionGroup({
  actions,
  onEditDetails,
  fallbackFocus,
  children,
}: {
  readonly actions: ActionsView;
  readonly onEditDetails?: () => void;
  readonly fallbackFocus?: RefObject<HTMLElement | null>;
  readonly children?: ReactNode;
}): ReactNode {
  const { session, signer, approving, expired } = useWalletSession();
  const track = use(RoomTrack);
  const router = useRouter();
  const [busy, setBusy] = useState<LiveKind | null>(null);
  const [, startNavigation] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);
  const focusFallback = useFocusFallback(fallbackFocus);
  const wallet = session?.wallet ?? null;
  // Cleared rather than hidden, so switching back to the wallet, or the action coming back, can't revive it.
  if (notice !== null && !noticeApplies(notice, { wallet, actions })) setNotice(null);

  const shownBusy = busyShown(busy, approving, actions);

  const runLive = async (action: LiveAction) => {
    const sentAs = session;
    const offeredBy = notice?.followUp?.kind === action.kind ? notice : null;
    inFlight.current = true;
    if (offeredBy === null) setNotice(null);
    setBusy(action.kind);
    const outcome = await live.run(action, { track, signer });
    inFlight.current = false;
    switch (outcome.kind) {
      case "open":
        // Inside the navigation's transition, the busy label lasts until the new page renders, and goes
        // back to idle when another navigation replaces this one.
        startNavigation(() => {
          setBusy(null);
          router.push(outcome.href);
        });
        return;
      case "done":
        setNotice(null);
        break;
      case "noted":
        setNotice({ text: outcome.text, followUp: null, wallet: sentAs?.wallet ?? null, raisedBy: offeredBy?.raisedBy ?? action });
        break;
      case "signed_out":
        if (sentAs) expired(sentAs);
        break;
      case "notice":
        setNotice({
          text: outcome.text,
          followUp: outcome.followUp ?? offeredBy?.followUp ?? null,
          wallet: sentAs?.wallet ?? null,
          raisedBy: offeredBy?.raisedBy ?? action,
        });
        break;
    }
    setBusy(null);
  };

  const run = async (action: Action) => {
    if (inFlight.current) return;
    const say = (text: string, followUp: Action | null = null) => setNotice({ text, followUp, wallet, raisedBy: action });
    if (actions.sample && ACTIONS[action.kind].needs !== "nothing") {
      const outcome = action.kind === "create_checkout" ? WORDS.nothing_created : WORDS.nothing_sent;
      say(`${ACTIONS[action.kind].label} ${WORDS.not_connected_in_sample} ${outcome}`, actions.sample.followUp);
      return;
    }
    if (isLiveAction(action)) return runLive(action);
    switch (action.kind) {
      case "copy_link":
        try {
          await navigator.clipboard.writeText(new URL(action.href, window.location.origin).href);
          say(WORDS.link_copied);
        } catch {
          say(WORDS.copy_failed);
        }
        return;
      case "edit_details":
        onEditDetails?.();
        return;
      case "reload_page":
        window.location.reload();
        return;
      default:
        say(`${ACTIONS[action.kind].label} ${WORDS.not_connected_yet} ${WORDS.nothing_sent}`);
    }
  };

  const stubbed =
    actions.sample !== null &&
    [actions.primary, ...actions.secondary].some(
      (a) => a !== null && a.kind !== "connect_wallet" && ACTIONS[a.kind].needs !== "nothing",
    );
  return (
    <div {...focusFallback} className="flex flex-col gap-4">
      {actions.primary && (
        <div>
          <ActionControl action={actions.primary} variant="primary" busy={shownBusy} onRun={run} />
        </div>
      )}
      {children}
      {actions.secondary.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {actions.secondary.map((a) => (
            <ActionControl
              key={controlKey(a)}
              action={a}
              variant={a.kind === "back_to_checkout" ? "link" : "quiet"}
              busy={shownBusy}
              onRun={run}
            />
          ))}
        </div>
      )}
      <div role="status" className="flex flex-col gap-1 text-small">
        {notice ? (
          <>
            <p className="flex items-start gap-2 font-semibold">
              <Icon name="info" />
              {notice.text}
            </p>
            {notice.followUp && <ActionControl action={notice.followUp} variant="link" busy={shownBusy} onRun={run} />}
          </>
        ) : (
          stubbed && <p className="text-muted">{WORDS.sample_caption}</p>
        )}
      </div>
    </div>
  );
}

/** I'm ready and Not ready yet are one toggle, so it keeps its button, and keyboard focus, when it flips. */
const controlKey = (action: Action): string => (action.kind === "mark_not_ready" ? "mark_ready" : action.kind);

function useFocusFallback(fallback: RefObject<HTMLElement | null> | undefined) {
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const lost = focused.current;
    const dropped = document.activeElement === null || document.activeElement === document.body;
    if (lost === null || lost.isConnected || !dropped) return;
    focused.current = null;
    (root.current?.querySelector<HTMLElement>("[data-action='primary']") ?? fallback?.current)?.focus();
  });
  return {
    ref: root,
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      focused.current = event.target;
    },
  };
}

function ActionControl({
  action,
  variant,
  busy,
  onRun,
}: {
  readonly action: Action;
  readonly variant: keyof typeof BUTTON;
  readonly busy: ActionKind | null;
  readonly onRun: (action: Action) => void;
}): ReactNode {
  const meta = ACTIONS[action.kind];
  const dataAction = variant === "primary" ? "primary" : "secondary";
  if (action.kind === "connect_wallet") return <ConnectWallet variant={variant} dataAction={dataAction} />;
  if ("href" in action && meta.element === "external_link") {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" data-action={dataAction} className={BUTTON[variant]}>
        {meta.label}
        <Icon name="external" />
        <span className="sr-only"> {WORDS.opens_new_tab}</span>
      </a>
    );
  }
  if ("href" in action && meta.element === "link") {
    return (
      <Link href={action.href} data-action={dataAction} className={BUTTON[variant]}>
        {action.kind === "back_to_checkout" && <Icon name="arrow-left" />}
        {meta.label}
      </Link>
    );
  }
  const idle = (
    <>
      {action.kind === "copy_link" && <Icon name="copy" />}
      {meta.label}
    </>
  );
  return (
    <button
      type="button"
      data-action={dataAction}
      aria-disabled={busy !== null || undefined}
      onClick={busy !== null ? undefined : () => onRun(action)}
      className={`${BUTTON[variant]} aria-disabled:cursor-progress`}
    >
      {busy === action.kind && "busy" in meta ? <BusyLabel busy={meta.busy} keepWidthOf={idle} /> : idle}
    </button>
  );
}

function BusyLabel({ busy, keepWidthOf }: { readonly busy: string; readonly keepWidthOf: ReactNode }): ReactNode {
  return (
    <span className="grid">
      <span className="invisible col-start-1 row-start-1 inline-flex items-center gap-2">{keepWidthOf}</span>
      <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-2">
        <Icon name="spinner" />
        {busy}
      </span>
    </span>
  );
}

function ConnectWallet({
  variant,
  dataAction,
}: {
  readonly variant: keyof typeof BUTTON;
  readonly dataAction: "primary" | "secondary";
}): ReactNode {
  const { view, connect } = useWalletSession();
  const action = view.connectAction;
  if (action === null) return null;
  if (action.kind === "get_phantom") {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" data-action={dataAction} className={BUTTON[variant]}>
        {action.label}
        <Icon name="external" />
        <span className="sr-only"> {WORDS.opens_new_tab}</span>
      </a>
    );
  }
  const busy = action.kind === "busy";
  return (
    <button
      type="button"
      data-action={dataAction}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : connect}
      className={`${BUTTON[variant]} aria-disabled:cursor-progress`}
    >
      {busy && <Icon name="spinner" />}
      {action.label}
    </button>
  );
}
