# America 250 Mall Ops

An interactive 3D exercise model of the National Mall for Saturday, July 4, 2026 (America 250). It was built as a live demo for the Big City Emergency Managers meeting. It is a fictional tabletop exercise built from public information, not an operational tool.

## Files

| File | Use |
|---|---|
| `index.html` | Page source published as a claude.ai Artifact. Live AI features (Ask the AI, decision critique, curveball injects, after-action report) only run inside Claude. |
| `standalone.html` | The same page with a full HTML wrapper, for opening straight from a laptop browser. It needs internet access for three.js and fonts. AI features fall back to the built-in exercise guidance. |
| `site/index.html` | Public copy, hosted at **https://america250-mall-ops.vercel.app**. It adds link-preview tags and asks search engines not to index it. |
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

## Updating the public site

Edit `index.html`, run `./build.sh`, commit and push. Then redeploy the Vercel project `america250-mall-ops` (team `ad-astra-ai`) from the new commit with root directory `america250/site`. The project is not linked to this repo, so pushes don't deploy automatically.

Deployment Protection on the project is set to "Only Preview Deployments", so the public address and the QR code open for anyone, with no Vercel login. Keep it that way, or the QR code will send people to a login page.
