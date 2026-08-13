import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { DemoNavigator } from "@/components/DemoNavigator";
import { DemoWatermark } from "@/components/DemoWatermark";

/**
 * Self-hosted fonts (no Google-hosted font loader — builds never fetch fonts).
 * Both files are latin-subset variable woff2 slices vendored into
 * src/fonts/; the declared weight ranges cover every weight the UI uses
 * (Fredoka 600/700 headings, Source Sans 3 400/600/700 body).
 */

/** Headings: bold rounded sans (brand.md visual match for the site). */
const fredoka = localFont({
  src: "../fonts/fredoka-latin-wght.woff2",
  weight: "300 700",
  style: "normal",
  variable: "--font-fredoka",
});

/** Body: clean humanist sans. */
const sourceSans = localFont({
  src: "../fonts/source-sans-3-latin-wght.woff2",
  weight: "200 900",
  style: "normal",
  variable: "--font-source-sans",
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
      className={`${fredoka.variable} ${sourceSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <DemoNavigator />
        <DemoWatermark />
      </body>
    </html>
  );
}
