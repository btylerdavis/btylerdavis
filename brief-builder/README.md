# Brief Builder

The Brief Builder is a free Ad Astra AI tool. A business owner answers eight questions and gets a "standing brief": instructions they paste once into a Claude Project or a ChatGPT Project, so their AI stops needing the morning briefing. It leads to the AI Command Setup ($300).

It is live at **https://adastra-brief-builder.vercel.app**.

## How it works

- **One static file, no backend.** `index.html` is the whole tool. It has no build step, no server and no live AI, so it costs nothing to run.
- **Brand tokens.** Colors and fonts come from `https://adastra-ai.com/brand.css`, the site's single source of truth. Every token has a fallback, so the page still renders if that file fails to load.
- **Privacy.** Answers stay in the visitor's browser. They are saved to `localStorage` under `aa-brief-builder-v1`, and nothing is sent anywhere.
- **The brief.** It is built as Markdown. Each use the visitor picks (emails, quotes, reports and so on) adds a short block of task rules. The brief always tells the AI to write `[CONFIRM: …]` instead of guessing a missing fact.
- **Example.** "Try an example first" fills in a fictional financial planning practice, so visitors see a finished brief in one tap.

## Deploying

The Vercel project is `adastra-brief-builder` (team `ad-astra-ai`), with root directory `brief-builder`. It isn't linked to the repo, so push the change, then redeploy from the new commit.

## Before moving it to adastra-ai.com

1. Remove `<meta name="robots" content="noindex">`. It's there so the vercel.app copy isn't indexed.
2. Add a canonical link to the final address.
3. Turn on Vercel Web Analytics for the project. Then track opens, copies, downloads and clicks on the two booking links, so you know whether the tool books calls.
