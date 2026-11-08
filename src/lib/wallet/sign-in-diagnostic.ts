import type { ErrorCode } from "@/client/contracts";

/** Stable classification of a sign-in failure. Never a message, signature, key, or cookie. */
export type SignInDiagnostic = {
  readonly stage: "session" | "challenge" | "sign" | "verify";
  readonly reason:
    | "no_account"
    | "cannot_sign"
    | "cannot_verify"
    | "wallet_changed"
    | "provider_error"
    | "rejected"
    | "output_count"
    | "output_missing"
    | "signed_bytes"
    | "signature_form"
    | "signature_check"
    | "unparsed"
    | "no_answer"
    | "unavailable"
    | ErrorCode;
  readonly code: number | null;
};

const DEBUG_FLAG = "onetabDebug";

let last: SignInDiagnostic | null = null;

export function readSignInDiagnostic(): SignInDiagnostic | null {
  return last;
}

export function debugFrom(env: { readonly search: string; readonly flag: string | null } | null): boolean {
  if (!env) return false;
  return new URLSearchParams(env.search).get(DEBUG_FLAG) === "1" || env.flag === "1";
}

function debugOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return debugFrom({ search: window.location.search, flag: window.localStorage.getItem(DEBUG_FLAG) });
  } catch {
    return false;
  }
}

export function signInDiagnosticMark(detail: SignInDiagnostic): string {
  return detail.code === null ? `${detail.stage}:${detail.reason}` : `${detail.stage}:${detail.reason}:${detail.code}`;
}

/** The only text debug mode may show. Absent unless debug is on and a failure was classified. */
export function visibleSignInNote(debug: boolean, detail: SignInDiagnostic | null): string | null {
  return debug && detail !== null ? signInDiagnosticMark(detail) : null;
}

export function currentSignInNote(): string | null {
  return visibleSignInNote(debugOn(), last);
}

export function clearSignInDiagnostic(): void {
  last = null;
  if (!debugOn() || typeof document === "undefined") return;
  delete document.documentElement.dataset.onetabSignin;
}

export function noteSignInDiagnostic(detail: SignInDiagnostic): void {
  last = detail;
  if (!debugOn()) return;
  console.info("onetab-signin", detail);
  if (typeof document === "undefined") return;
  document.documentElement.dataset.onetabSignin = signInDiagnosticMark(detail);
}
