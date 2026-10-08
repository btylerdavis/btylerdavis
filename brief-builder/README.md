# Brief Builder

The Brief Builder is a free Ad Astra AI tool. A business owner answers eight questions and gets a "standing brief": instructions they paste once into a Claude Project or a ChatGPT Project, so their AI stops needing the morning briefing. It leads to the AI Command Setup ($300).

It is live at **https://adastra-brief-builder.vercel.app**.

## How it works

- **One static file, no backend.** `index.html` is the whole tool. It has no build step, no server and no live AI, so it costs nothing to run.
- **Brand tokens.** Colors and fonts come from `https://adastra-ai.com/brand.css`, the site's single source of truth. Every token has a fallback, so the page still renders if that file fails to load.
- **Privacy.** Answers are saved in the visitor's browser under the `localStorage` key `aa-brief-builder-v1` and never leave the device. Damaged or outdated saved data is cleaned up when the page loads.
- **The brief.** It is built as Markdown. Each use the visitor picks (emails, quotes, reports and so on) adds a short block of task rules. The brief always tells the AI to write `[CONFIRM: …]` instead of guessing a missing fact.
- **Example.** "Try an example first" previews the brief for a fictional financial planning practice. It never replaces or saves over the visitor's own answers, and copying stays off until they start their own.
- **Exact wording.** Facts keep their numbers ("0.75%" stays "0.75%"). Hard lines keep the owner's wording. "Never" is only added in front of a bare action, so a line like "Avoid…" is never flipped.

## Deploying

The Vercel project is `adastra-brief-builder` (team `ad-astra-ai`), with root directory `brief-builder`. It isn't linked to the repo, so push the change, then redeploy from the new commit.

## Before moving it to adastra-ai.com

1. Remove `<meta name="robots" content="noindex">`. It's there so the vercel.app copy isn't indexed.
2. Add a canonical link to the final address.
3. Turn on Vercel Web Analytics for the project. Then track opens, copies, downloads and clicks on the two booking links, so you know whether the tool books calls.
