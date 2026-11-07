import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OneTab",
  description: "Split one purchase with friends using test USDC on Solana Devnet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
