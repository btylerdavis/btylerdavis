# America 250 · National Mall exercise

An interactive 3D exercise model of the National Mall for Saturday, July 4, 2026 (America 250). It was built as a live demo for the Big City Emergency Managers meeting. It is a fictional tabletop exercise: real places, invented incidents, illustrative numbers. It is not an operational tool, and no emergency manager or agency has reviewed it. It began under the working name Mall Ops, and the Vercel project is still called `america250-mall-ops`.

## Files

| File | Use |
|---|---|
| `index.html` | Page source published as a claude.ai Artifact. Live AI features (Ask the AI, decision critique, curveball injects, after-action report) only run inside Claude. |
| `standalone.html` | The same page with a full HTML wrapper, for opening straight from a laptop browser. It needs internet access for three.js and fonts. AI features fall back to the built-in exercise guidance. |
| `site/index.html` | Public copy, hosted at **https://america250-mall-ops.vercel.app**. It adds link-preview tags, asks search engines not to index it, counts visits (see "Visit counting"), and loads the 3D library from `site/vendor` instead of a CDN, because some managed networks block the CDNs. |
| `site/og.jpg` | The 1200×627 link-preview card shown when the address is shared (LinkedIn, Slack, iMessage). It is a render of the app's map beside the title, served from the site itself. Replace it if the look changes. |
| `build.sh` | Rebuilds `standalone.html` and `site/index.html` from `index.html`. Run it after every edit. |
| `america250-qr.png` | QR code for the public address, for slides or handouts. The page's **Share** button shows the same code. |

## What's in it

- A stylized 3D model of DC built from public geography: Mall landmarks, about 800 city blocks, the Potomac, Metro stations, and a crowd model of 16,000 points.
- 9 scripted injects (an MSEL) from 12:15 to about 23:00, across ESF-1, 6, 8, 9, 12, 13 and 15. Each has a decision point with three options, simulated consequences and planner guidance.
- An exercise clock with a time-lapse sky, a storm, fireworks over the Reflecting Pool, and post-fireworks egress toward Metro.
- Four simulated sensor feeds (EO, IR and night vision) rendered from virtual cameras in the model.
- Live AI (through the Artifact `sample` capability), which:
  - answers questions using the current exercise picture
  - critiques each decision
  - turns any what-if from the room into a new inject on the map
  - drafts an HSEEP-style after-action report
- AI-generated aerial stills, linked from site and incident cards and labeled as simulated.
- **What-if dials** (map chip): attendance, heat index, storm arrival (or no storm), and a Blue/Orange/Silver line outage.
  - The crowd, HUD, storm timing and affected injects update live.
  - An outlook table compares plan vs what-if, and "Preview on the map" jumps to the impact moment and back.
  - "Ask AI what changed" explains the new risk (offline: rule-based note).
- **Your City** (header button, phone tab, or the How-this-was-built panel): the AI drafts a six-inject tabletop for any city and event.
  - The draft is playable as graded decision cards, and the exercise packet can be copied, saved or shared.
  - Offline, a prepared Chicago example is shown.
- **Phone layout** (≤640px): opens on the map, decisions slide up from the bottom, a bottom tab bar, and a floating Next button.
  - While a decision is open, the controls and stat tiles step aside and the map fills the screen down to the tab bar.
  - The card is only as tall as the question and its options, so the map keeps 2–3 times more room above it.
  - The header and clock stay visible, and everything returns when you resume.
- **Ad Astra AI look:**
  - Colors come from the brand tokens in `adastra-ai.com/brand.css`: paper `#FBF8F2`, navy `#0E2240` and gold `#C9A968`.
  - Headings are set in Cormorant Garamond and the interface in Inter.
  - Gold is used for fills, rules and text on navy, never for text on paper. Labels and accents on paper are navy, as on the site.
  - Every text element passes WCAG AA contrast in the tested states, on desktop and phone.
- **Map labels don't pile up.** When two labels would overlap, the lower-priority one hides until you zoom or rotate. The order is: the active incident, other incidents, landmarks, then Metro stations.

## Presenter flow on a phone (about 5 minutes)

1. Press **Next inject** and talk through the decision. Pick an option, then press **Critique my call**.
2. Ask the room for a what-if, type it into **Throw a curveball**, and let the AI build it onto the map.
3. Jump to the storm at 19:55. Shelter or evacuate? Watch the crowd move and the fireworks shift.
4. Tap **What-if**, drag attendance to +30% and move the storm to 21:00, then **Preview on the map** and **Ask AI what changed**.
5. Tap **Your city**, hand over the phone, and let them name their city and event. Play one inject, then copy or share the packet.
6. Finish with **How this was built** and **Share** (people can scan the QR code from your screen).

## Where it's linked

On adastra-ai.com (website repo `btylerdavis/byte-perfect-page`, PR #5). Every link opens in a new tab and carries `utm_source=adastra-ai.com` and `utm_medium=site`, plus its own `utm_campaign`:

- **Homepage**, in the "Free tools" section right after the diagnostic (`home-tools`): "America 250 National Mall, a bigger build for emergency managers".
- **Every page's footer**, as "America 250 demo" (`footer`).
- **Services**, under item 03 "One working proof tool": "See how far a build can go: a 3D demo for emergency managers ↗" (`services-edge-audit`).

The address lives in one place: the `AMERICA_250_URL` constant in that repo's `src/lib/links.ts`. If this site moves, change that line. The page stays `noindex`, so linking to it does not make it appear in search results.

## Visit counting

The public copy counts visits and a few button clicks with Vercel Web Analytics. The Claude copy (`index.html`) and `standalone.html` count nothing: `build.sh` adds the snippet to `site/index.html` only, and `track()` in the page does nothing where the snippet is absent.

- **Counted:** page views (with referrer, country and device, which Vercel supplies) and ten named events: `start` (the first Play, Next, incident picked from the list or timeline, or decision), `decision` (`inject` is one of the nine incident ids, or `curveball` for one made up in the room, plus option A, B or C), `whatif`, `your_city`, `how_built`, `share`, `share_copy`, `ask`, `aar`, and `cta_click` (`where` is `footer`, `how-built` or `link`; middle-clicks count, right-clicks don't).
- **Never sent:** anything a visitor types (city, event, questions, curveball text), or the wording of any incident or decision. The only exercise detail is which of the fixed incidents was decided and which option letter. An event is a fixed name plus short fixed labels.
- **Do Not Track and Global Privacy Control:** a visitor who sends either is not counted at all (`beforeSend` in the snippet).
- **Cookies:** the footer says the page counts visits and clicks, and does not say "no cookies". Vercel describes the product as cookie-free (a daily hash of the request instead), but its docs only name third-party cookies. If a reviewer needs that in writing, ask Vercel.
- **Turning it on:** Vercel dashboard, project `america250-mall-ops`, Analytics, Enable. Then redeploy: the `/_vercel/insights/script.js` route exists only on deployments made after the switch is on.
- **Reading it:** the project's Analytics tab, or ask Claude to query it (page views and events, by `eventName`, `utmSource` or `referrerHostname`). Which breakdowns you get can depend on the Vercel plan.
- **Tagging links:** LinkedIn posts use `?utm_source=linkedin`. QR-code and slide traffic is untagged and shows as direct. The page has no `og:url` on purpose: LinkedIn may treat it as the canonical address and drop the tag from card clicks.
- **Turning it off:** set `ANALYTICS=''` and `COUNT_NOTE=''` in `build.sh`, rebuild and redeploy. Do not only switch Analytics off in the dashboard: the footer would still say the page counts visits, and every load would ask for a script that returns 404.
- **Build guard:** `build.sh` builds the public copy in a temp file and refuses to replace `site/index.html` if the footer sentence did not make it in (for example if `<!--COUNT_NOTE-->` was deleted from `index.html`), so the counting script can never ship without its disclosure.

## Updating the public site

Edit `index.html`, run `./build.sh`, commit and push. Then redeploy the Vercel project `america250-mall-ops` (team `ad-astra-ai`) from the new commit with root directory `america250/site`. The project is not linked to this repo, so pushes don't deploy automatically.

Deployment Protection on the project is set to "Only Preview Deployments", so the public address and the QR code open for anyone, with no Vercel login. Keep it that way, or the QR code will send people to a login page.

LinkedIn caches the first preview it sees for a link. After changing the preview tags or `site/og.jpg`, run the address through LinkedIn's Post Inspector (https://www.linkedin.com/post-inspector/) to refresh it before sharing.
