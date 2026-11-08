import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { ArrivalWatcher } from "@/components/arrival-watcher";
import { LiveWalletProvider } from "@/components/wallet/wallet-scope";
import "./globals.css";

const sans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson-next", display: "swap" });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--font-atkinson-mono", display: "swap" });

export const metadata: Metadata = {
  title: "OneTab",
  description: "Split one purchase between two or three friends with test USDC on Solana Devnet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-white font-sans text-body font-normal text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-control focus:bg-brand focus:px-4 focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <ArrivalWatcher />
        <LiveWalletProvider>{children}</LiveWalletProvider>
      </body>
    </html>
  );
}
