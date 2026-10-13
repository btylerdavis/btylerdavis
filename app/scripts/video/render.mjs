// Renders the narrated Phase 1 walkthrough (scripts/video/walkthrough.src.html)
// to an MP4, frame by frame, so the video always matches the roadmap copy.
//
//   node scripts/video/render.mjs <out-dir> [narration.wav]
//
// Needs Playwright's Chromium (a devDependency) and ffmpeg on PATH. Frames that
// are identical to the previous one (nothing animating) are hard-linked rather
// than re-captured, which keeps a full render to a few minutes.
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir = "video-out", narration] = process.argv.slice(2);
const FPS = 30;
const WORKERS = 4;

// Same font files the app's brand uses (Google Fonts, latin subset).
const FONTS = {
  "hanken.woff2": "https://fonts.gstatic.com/s/hankengrotesk/v12/ieVn2YZDLWuGJpnzaiwFXS9tYtpd59A.woff2",
  "playfair.woff2": "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvXDXbtM.woff2",
  "playfair-italic.woff2": "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFRD-vYSZviVYUb_rj3ij__anPXDTnCjmHKM4nYO7KN_qiTXtHA-Q.woff2",
};

mkdirSync(path.join(outDir, "fonts"), { recursive: true });
mkdirSync(path.join(outDir, "frames"), { recursive: true });
for (const [name, url] of Object.entries(FONTS)) {
  const dest = path.join(outDir, "fonts", name);
  if (!existsSync(dest)) writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
}
const logo = readFileSync(path.join(here, "logo-dark-bg.svg"), "utf8").trim();
const page = path.resolve(outDir, "walkthrough.html");
writeFileSync(page, readFileSync(path.join(here, "walkthrough.src.html"), "utf8").replace("__LOGO__", logo));

async function renderRange(start, end) {
  const browser = await chromium.launch();
  const tab = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tab.goto(`file://${page}`);
  await tab.evaluate(() => window.READY);
  let previous = null;
  let previousFile = null;
  for (let i = start; i < end; i++) {
    const signature = await tab.evaluate((t) => window.seek(t), i / FPS);
    const file = path.join(outDir, "frames", `f${String(i).padStart(5, "0")}.png`);
    if (signature === previous && previousFile) linkSync(previousFile, file);
    else {
      await tab.screenshot({ path: file });
      previous = signature;
      previousFile = file;
    }
  }
  await browser.close();
}

const probe = await chromium.launch();
const probeTab = await probe.newPage();
await probeTab.goto(`file://${page}`);
await probeTab.evaluate(() => window.READY);
const duration = await probeTab.evaluate(() => window.DURATION);
await probe.close();

const total = Math.ceil(duration * FPS);
const per = Math.ceil(total / WORKERS);
await Promise.all(
  Array.from({ length: WORKERS }, (_, k) => renderRange(k * per, Math.min(total, (k + 1) * per))),
);

const out = path.join(outDir, "walkthrough.mp4");
const args = ["-y", "-framerate", String(FPS), "-i", path.join(outDir, "frames", "f%05d.png")];
if (narration) args.push("-i", narration, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k");
args.push("-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-t", String(duration), out);
execFileSync("ffmpeg", args, { stdio: "inherit" });
console.log(`wrote ${out} (${total} frames, ${duration}s)`);
