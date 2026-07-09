/**
 * record-walkthrough.mjs — screen-records a ~80s guided tour of the demo app.
 *
 * Usage:
 *   node scripts/record-walkthrough.mjs
 *
 * Environment:
 *   BASE_URL       app under test (default http://localhost:3000)
 *   OUT_DIR        where walkthrough.webm lands (default ./recordings)
 *   CHROMIUM_PATH  optional explicit Chromium binary (for environments whose
 *                  preinstalled browser revision differs from the playwright
 *                  npm package — e.g. /opt/pw-browsers/chromium)
 *
 * The tour is read-only where it matters: the retail screener stops BEFORE
 * the consent step (no participant row is created), the clinic scene re-uses
 * the existing Marcus Reed record (append-only Lane A re-grant, no new
 * participant), the HST parse is previewed but never written, and the
 * revocation scene ends on "Restore consents" so Marcus finishes granted.
 */
import { mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? "recordings");
const MARCUS_ID = "d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17";
const SIZE = { width: 1280, height: 800 };

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const context = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: OUT_DIR, size: SIZE },
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);

const pause = (ms) => page.waitForTimeout(ms);

async function goto(route) {
  await page.goto(BASE_URL + route, { waitUntil: "load" });
  await pause(700); // let charts/animations settle
}

/** Smoothly scrolls the window so `locator`'s element sits ~1/4 from the top. */
async function smoothScrollTo(locator, durationMs) {
  const y = await locator.first().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top + window.scrollY - window.innerHeight / 4;
  });
  await smoothScrollToY(Math.max(0, y), durationMs);
}

async function smoothScrollToY(targetY, durationMs) {
  await page.evaluate(
    ([target, duration]) =>
      new Promise((resolve) => {
        const start = window.scrollY;
        const distance = target - start;
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
        const step = (now) => {
          const t = Math.min(1, (now - t0) / duration);
          window.scrollTo(0, start + distance * ease(t));
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [targetY, durationMs]
  );
}

async function pageBottomY() {
  return page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight
  );
}

/** Runs a scene; logs and moves on if a selector went missing so the video still completes. */
async function scene(name, fn) {
  process.stdout.write(`scene: ${name} ... `);
  try {
    await fn();
    console.log("ok");
  } catch (error) {
    console.log(`FAILED (continuing): ${error.message?.split("\n")[0]}`);
    process.exitCode = 1;
  }
}

const startedAt = Date.now();

// --- 1. Home: hero, then drift down to the demo map -------------------------
await scene("home hero + demo map", async () => {
  await goto("/");
  await page.getByRole("heading", { name: "Better Sleep Starts with Data." }).waitFor();
  await pause(4000);
  await smoothScrollTo(page.getByText("Demo map", { exact: true }), 3000);
  await pause(1200);
});

// --- 2. Retail door: name + first three STOP-BANG answers -------------------
// Deliberately stops before scoring/consent: nothing is written to the DB.
await scene("retail STOP-BANG", async () => {
  await goto("/enroll/retail");
  await page.locator("#displayName").pressSequentially("Jordan Avery", { delay: 70 });
  await pause(400);
  await page.getByRole("button", { name: "Start my sleep check" }).click();
  await page.getByText("The STOP-BANG sleep check").waitFor();
  await pause(800);
  const answers = ["Yes", "No", "Yes"]; // first three questions, visible clicks
  for (let i = 0; i < answers.length; i++) {
    const yes = page.getByRole("button", { name: "Yes", exact: true }).nth(i);
    const no = page.getByRole("button", { name: "No", exact: true }).nth(i);
    const target = answers[i] === "Yes" ? yes : no;
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await pause(1000);
  }
});

// --- 3. Clinic door: existing patient -> consent -> sample HST report -------
// Uses the existing Marcus Reed record so no participant row is created; the
// consent step appends a Lane A re-grant (append-only ledger, stays granted).
// The parsed report is previewed only — never written to the record.
await scene("clinic HST sample report", async () => {
  await goto("/enroll/clinic");
  await page.getByRole("button", { name: "Existing retail participant" }).click();
  await page.locator("#lookup").pressSequentially("Marcus Reed", { delay: 60 });
  await page.getByRole("button", { name: "Search" }).click();
  const match = page.getByRole("button").filter({ hasText: "retail participant ·" }).first();
  await match.waitFor();
  await pause(600);
  await match.click();
  await pause(500);
  await page.getByRole("button", { name: "Continue to consent" }).click();
  await page.getByText("Research consent & HIPAA authorization").waitFor();
  await pause(800);

  // Sign the pad with a little mouse squiggle.
  const canvas = page.locator('canvas[aria-label="Signature pad"]');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 120, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx - 120 + i * 20, cy + Math.sin(i * 1.1) * 22, { steps: 3 });
  }
  await page.mouse.up();
  await pause(600);

  await page.getByRole("button", { name: "Record consent & authorization" }).click();
  await page.getByText("Home sleep test intake").waitFor();
  await pause(800);
  await page.getByRole("button", { name: "Use sample text report" }).click();
  await page.getByText("Positional OSA").waitFor();
  await pause(4000);
});

// --- 4. Marcus's trends: the full nightly story ------------------------------
await scene("marcus trends scroll", async () => {
  await goto(`/participant/${MARCUS_ID}/trends`);
  await pause(1500);
  const supineCard = page.getByText("Time sleeping on the back");
  await smoothScrollTo(supineCard, 5000); // slow drift down to the flagship chart
  await pause(3000); //                      hold on the supine-time chart
  await smoothScrollToY(await pageBottomY(), 5000); // finish the page
  await pause(800);
});

// --- 5. Flagship research dashboard ------------------------------------------
await scene("positional research", async () => {
  await goto("/research/positional");
  await pause(5000); // weekly supine-by-band chart is at the top
  await smoothScrollTo(page.getByText("Before / after by mattress brand"), 2000);
  await pause(2000);
});

// --- 6. Revocation kill switch: revoke, read the report, restore -------------
await scene("revocation revoke + restore", async () => {
  await goto("/compliance/revocation");
  await pause(3000);
  const revoke = page.getByRole("button", { name: /Revoke all consents — Marcus Reed/ });
  await revoke.scrollIntoViewIfNeeded();
  await pause(500);
  await revoke.click();
  const report = page.getByText("enforcement re-checked live");
  await report.waitFor({ timeout: 30_000 });
  await smoothScrollTo(report, 1200);
  await pause(5000); // before/after table
  await page.getByRole("button", { name: "Restore consents (demo reset)" }).click();
  await page.getByText(/Restored:/).waitFor({ timeout: 30_000 });
  await pause(4000); // Marcus ends the scene fully granted again
});

// --- 7. Exec dashboard --------------------------------------------------------
await scene("exec dashboard", async () => {
  await goto("/exec");
  await pause(5000);
  await smoothScrollTo(page.getByText("Partnership pipeline", { exact: true }), 2000);
  await pause(2000);
});

// --- 8. Back home -------------------------------------------------------------
await scene("closing hero", async () => {
  await goto("/");
  await pause(3000);
});

const video = page.video();
await context.close();
await browser.close();

const rawPath = await video.path();
const finalPath = path.join(OUT_DIR, "walkthrough.webm");
renameSync(rawPath, finalPath);
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
const mb = (statSync(finalPath).size / 1024 / 1024).toFixed(1);
console.log(`\nSaved ${finalPath} (${mb} MB) — ~${seconds}s of tour driven at ${BASE_URL}`);
