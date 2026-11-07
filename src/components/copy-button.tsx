"use client";

import { useState, type ReactNode } from "react";
import { WORDS } from "@/client/catalog";
import { Icon } from "./icon";
import { BUTTON } from "./button";

export function CopyButton({ value, labelSuffix }: { readonly value: string; readonly labelSuffix: string }): ReactNode {
  const [note, setNote] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setNote(WORDS.copied);
    } catch {
      setNote(WORDS.copy_failed);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={copy} className={BUTTON.quiet}>
        <Icon name="copy" />
        {WORDS.copy}
        <span className="sr-only"> {labelSuffix}</span>
      </button>
      <span role="status" className="text-small text-muted">
        {note}
      </span>
    </span>
  );
}
