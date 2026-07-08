# Sleeptopia Branding Kit (demo)

**Status: structure complete — awaiting exact assets (see "What Ben provides" below).**

## Why the assets aren't pulled yet

This build environment's network policy blocks outbound requests to sleeptopia.com (and to archive/proxy mirrors of it), so the logo file and exact colors could not be extracted automatically. Everything that *is* verifiable from public listings is captured below; the palette in [tokens.json](tokens.json) is a provisional sleep-brand theme, clearly flagged, that keeps UI work unblocked until the real values drop in.

## Verified brand facts (public listings)

| Item | Value |
|---|---|
| Name | Sleeptopia (Sleeptopia, Inc.) |
| Tagline | "Your End-To-End Sleep Apnea Service Provider" (site title) |
| Address | 411 S Pattie St, Wichita, KS 67211 |
| Phone | (316) 573-5699 |
| Positioning | Home sleep tests, same-day setup, CPAP machines/masks/supplies, sleep coaches, works with all insurances |
| Co-brand for demo | "Sleeptopia × The Mattress Hub" (retail-door screens + footer) |

## What Ben provides (≈5 minutes, from any browser)

1. **Screenshot** of the sleeptopia.com homepage (full page if possible) — paste it into the chat. Exact colors get sampled from it and tokens.json updated.
2. **Logo file**: right-click the site logo → "Save image as…" → drop it in chat or commit to `branding/assets/sleeptopia-logo.png` (plus a white/knockout version if the site has one in the footer).
3. Optional: the fonts — view page source, search "fonts.googleapis" and paste the URL(s).

## How the app consumes this

- `app/` reads `branding/tokens.json` at build time → Tailwind theme extension (week 2 UI task).
- Every screen: Sleeptopia logo/wordmark top-left, `DEMO DATA` watermark bottom-right, co-brand line in footer.
- Until the logo file lands, the app renders a wordmark fallback ("Sleeptopia" in heading font + primary color, moon glyph) — swapping to the real logo is a single file drop, no code change.
