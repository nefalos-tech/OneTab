"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { live } from "@/client/live-actions";

/** Sits in the root layout because a move's destination may never mount, and only the layout sees every path after it. */
export function ArrivalWatcher(): ReactNode {
  const pathname = usePathname();
  useEffect(() => live.arrivals.seen(pathname), [pathname]);
  return null;
}
