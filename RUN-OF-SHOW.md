# Run of Show — Sleeptopia Demo for Kevin (~25 min)

## Before Kevin sits down (10 min, in Terminal, inside the `app` folder)

```
git pull                # grabs last-minute fixes + demo navigator
npm install             # fast if nothing new
npm run build
npm run seed            # ~90s — wait for the "Marcus Reed: d81a5f64..." line
npm run start           # leave this window open; app at localhost:3000
```

Then: open **localhost:3000**, close every other tab and app, Do Not Disturb ON (laptop + phone), power connected. Use the floating **"Demo map"** pill (bottom-right of every page) to move between acts — never type URLs in front of Kevin.

**If anything looks wrong mid-demo:** Marcus missing from /coach → you left him revoked: go to Revocation, purple **Restore consents** button. Anything worse → Ctrl+C the server, `npm run seed`, `npm run start` (~2 min, narrate the architecture while it runs).

---

## The arc — one line + one paragraph per stop

**Act 1 · The retail door — `/enroll/retail` (3 min).** Hand Kevin the screen; he takes the 8-question STOP-BANG screener as himself. The store floor becomes a referral engine: high risk → home-sleep-test offer → plain-language consent with per-data-type toggles → wearable connect → mattress SKU attaches at checkout. **Have him turn one consent toggle OFF** — the confirmation shows that data was dropped at the door. Say: *"every toggle is enforced by the software, not filed in a drawer."*

**Act 2 · The clinic door — `/enroll/clinic` (3 min).** Same person, other door. Look up the record he just created; sign the clinical consent on the pad; click **"Use sample CSV export"** — a real home-sleep-test file parses on screen and the **Positional OSA flag computes itself** (AHI 24 overall, 41 on his back). Record CPAP setup, then the linkage consent joins store + clinic records. Say: *"the two halves of this person only connect because he said yes a second time."*

**Act 3 · The time machine — `/timemachine` (2 min).** The demo's engine: click **+7 days** and, while it churns ~20 seconds, narrate: *"it's generating a week of nights for two thousand people — wearable, CPAP, the under-mattress sensor — every row through the same consent gates production will use. The patients are synthetic; the plumbing is real."* Watch the registry totals jump.

**Act 4 · Three views of Marcus — Demo map → Marcus's trends, then `/coach` (4 min).** Marcus, 52, is 90 days into treatment. Scroll the trends slowly; **linger on "Time sleeping on the back"** — the line drops right at the mattress-delivery marker. That chart is the business thesis. Then the coach portal: the whole panel, adherence funnel, data-quality flags, names shown only where consent allows — and the query-time line ("that searched 780,000 records in under a second").

**Act 5 · The research engine — `/research/positional` (4 min).** Zoom out from one man to 2,000. The flagship dashboard: supine-time change by mattress firmness with confidence intervals — the money screen. If Kevin leans in: `/research/robustness` is the "should we believe it?" page (missingness, a negative control that stays flat, sensitivity math) — *"we interrogate our own result before anyone else does."*

**Act 6 · The compliance spine — `/research/deid`, then `/compliance/revocation` (3.5 min).** De-id: Marcus twice — identified vs. research tier (pseudonym, shifted dates) side by side. Then the showstopper: revoke **just wearable** (only those charts go dark), restore, then **Revoke all** — his name vanishes and the cohort count ticks 2,000 → 1,999 live. Say: *"outside auditors tried to make this leak and couldn't."* **Then press the purple Restore button — do not skip.**

**Act 7 · The business layer — `/partner`, then `/exec` (3 min).** The partner portal opens with a DUA gate — the gate *is* the point; inside, Tempur-Sealy sees only banded, de-identified aggregates. *"We monetize proof, never people."* Then Kevin's screen: the exec dashboard — the store→clinic referral funnel with dollar estimates, and the revenue calculator whose chip turns green where the platform pays for itself. If he's hungry for more: **Draft a study proposal** (partner dashboard) prices a research question in one click.

**Act 8 · The reveal — say it, don't click (1.5 min).** *"Everything you touched is real software — the only thing simulated is the patients, because real ones need the IRB and legal work in the plan. Four adversarial audits are behind this build; every finding fixed, with the paper trail in the repo. What's left is making the patients real — and that plan is written."* Then stop talking and let him ask.

---

**Reserve rule for every "can it do X?"**: honest one-liner → show what exists → name what it takes to build. Never "that's fake" — *"that's the reserve layer."*
