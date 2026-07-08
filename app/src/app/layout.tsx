import type { Metadata } from "next";
import { Fredoka, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { DemoWatermark } from "@/components/DemoWatermark";

/** Headings: bold rounded sans (brand.md visual match for the site). */
const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
});

/** Body: clean humanist sans. */
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
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
        <DemoWatermark />
      </body>
    </html>
  );
}
