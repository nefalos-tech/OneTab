"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { WORDS } from "@/client/catalog";
import { BUTTON } from "../button";
import { Icon } from "../icon";
import { AddressText } from "../values";
import { useWalletSession } from "./wallet-scope";

export const WALLET_CONTROL_ID = "wallet-control";
const MENU_ID = "wallet-menu";
const MENU_ITEM = "inline-flex min-h-11 w-full items-center gap-2 rounded-control px-3 font-semibold text-brand hover:bg-brand-soft";

export function WalletControl(): ReactNode {
  const { view, connect, disconnect } = useWalletSession();
  const { control } = view;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuOpen = open && control.kind === "account";

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [menuOpen]);

  const close = () => {
    setOpen(false);
    setNote("");
    button.current?.focus();
  };

  const copy = async () => {
    if (control.kind !== "account") return;
    try {
      await navigator.clipboard.writeText(control.address);
      setNote(WORDS.copied);
    } catch {
      setNote(WORDS.copy_failed);
    }
  };

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) close();
      }}
    >
      <button
        ref={button}
        id={WALLET_CONTROL_ID}
        type="button"
        aria-disabled={control.kind === "busy" ? true : undefined}
        aria-expanded={control.kind === "account" ? menuOpen : undefined}
        aria-controls={control.kind === "account" ? MENU_ID : undefined}
        onClick={() => {
          if (control.kind === "connect") connect();
          if (control.kind === "account") {
            setNote("");
            setOpen(!menuOpen);
          }
        }}
        className={`${BUTTON.quiet} text-body aria-disabled:cursor-progress`}
      >
        <Icon name={control.kind === "busy" ? "spinner" : "wallet"} />
        {control.kind === "account" ? (
          <>
            <span className="sr-only">{control.signedIn ? WORDS.signed_in_as : WORDS.wallet} </span>
            <AddressText value={control.address} form="short" />
          </>
        ) : (
          control.label
        )}
      </button>
      {menuOpen && (
        <div id={MENU_ID} className="absolute top-full right-0 z-10 mt-2 flex w-56 flex-col gap-1 rounded-control border border-line-strong bg-white p-2 text-body">
          <button type="button" onClick={copy} className={MENU_ITEM}>
            <Icon name="copy" />
            {WORDS.copy_address}
          </button>
          <button
            type="button"
            onClick={() => {
              disconnect();
              close();
            }}
            className={MENU_ITEM}
          >
            {WORDS.disconnect}
          </button>
          <p role="status" className="px-3 text-small text-muted empty:hidden">
            {note}
          </p>
        </div>
      )}
    </div>
  );
}
