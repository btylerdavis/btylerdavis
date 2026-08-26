import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { DemoNavigator } from "@/components/DemoNavigator";
import { DemoWatermark } from "@/components/DemoWatermark";

/**
 * Self-hosted fonts (no Google-hosted font loader — builds never fetch
 * fonts). The new Sleeptopia design language type pair (sleeptopia-site
 * design/DIRECTION.md): Playfair Display for serif display statements,
 * Hanken Grotesk for everything functional. Both are latin-subset variable
 * woff2 slices vendored into src/fonts/.
 */

/** Serif display — Playfair Display. */
const playfair = localFont({
  src: "../fonts/playfair-display-latin-wght.woff2",
  weight: "400 900",
  style: "normal",
  variable: "--font-playfair",
});

/** Functional sans — Hanken Grotesk. */
const hanken = localFont({
  src: "../fonts/hanken-grotesk-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  title: {
    default: "Sleeptopia — Better Sleep Starts with Data",
    template: "%s — Sleeptopia",
  },
  description:
    "Sleeptopia × The Mattress Hub sleep outcomes demo. Synthetic cohort — no real patient data.",
  icons: { icon: "/brand/sleeptopia-mark.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${hanken.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <DemoNavigator />
        <DemoWatermark />
      </body>
    </html>
  );
}
