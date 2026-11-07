const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-5 py-2 font-semibold transition-colors duration-200";

export const BUTTON = {
  primary: `${BASE} bg-brand text-white hover:bg-ink active:bg-ink`,
  quiet: `${BASE} border border-line-strong bg-white text-brand hover:bg-brand-soft active:bg-brand-soft`,
  link: "inline-flex min-h-11 items-center gap-2 font-semibold text-brand underline underline-offset-4 hover:text-ink",
} as const;
