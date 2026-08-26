import localFont from "next/font/local";

/**
 * New-direction type pair (sleeptopia-site design/DIRECTION.md): serif
 * display = Playfair Display, sans = Hanken Grotesk. Self-hosted latin
 * variable woff2 slices vendored into src/fonts (same no-network-fetch
 * discipline as the root layout's fonts). Pages in the new design language
 * apply `${playfair.variable} ${hanken.variable}` on their root wrapper so
 * the files load only where the new language is used.
 */

export const playfair = localFont({
  src: "../../fonts/playfair-display-latin-wght.woff2",
  weight: "400 900",
  style: "normal",
  variable: "--font-playfair",
});

export const hanken = localFont({
  src: "../../fonts/hanken-grotesk-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-hanken",
});

/** Wrapper classes for a page styled in the new design language. */
export const newDirectionClass = `${playfair.variable} ${hanken.variable} font-grotesk`;
