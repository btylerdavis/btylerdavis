#!/usr/bin/env node
/**
 * Assemble the client evaluation package (run-only, no source, no docs).
 *
 * Prerequisites (run in this order):
 *   1. npm run seed                  — pristine default cohort in prisma/dev.db
 *   2. EVAL_BUILD=1 npm run build    — standalone bundle in .next/standalone
 *      (EVAL_BUILD also builds with images.unoptimized so the package has no
 *      sharp native-binary dependency; see next.config.ts)
 *
 * Then:
 *   node scripts/package-eval.mjs [output-dir]
 *
 * Output layout (default ./dist/sleeptopia-eval):
 *   READ ME FIRST.txt                — Kevin-facing instructions
 *   Start Sleeptopia (Mac).command   — double-click launcher (chmod +x; zip
 *                                      with `zip -ry` to keep the exec bit)
 *   Start Sleeptopia (Windows).bat   — double-click launcher (CRLF)
 *   start-eval.js                    — expiry gate + env setup + server boot
 *   app/                             — .next/standalone + .next/static + public
 *   data/dev.db                      — pre-seeded synthetic SQLite database
 *
 * The script verifies the package afterwards: Prisma engines for
 * darwin-arm64 / darwin (Intel) / windows present, no src/, no *.md files.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "dist", "sleeptopia-eval"));

const standaloneDir = path.join(repoRoot, ".next", "standalone");
const staticDir = path.join(repoRoot, ".next", "static");
const publicDir = path.join(repoRoot, "public");
const devDb = path.join(repoRoot, "prisma", "dev.db");

function die(msg) {
  console.error(`package-eval: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(standaloneDir, "server.js")) || !fs.existsSync(staticDir)) {
  // No standalone bundle yet: run the flagged build ourselves so callers
  // never have to juggle the EVAL_BUILD env var (it kept getting lost when
  // command lines were pasted in pieces).
  console.log("package-eval: no standalone bundle found — running EVAL_BUILD=1 npm run build now (~2 min)...");
  execSync("npm run build", { cwd: repoRoot, stdio: "inherit", env: { ...process.env, EVAL_BUILD: "1" } });
}
if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  die("standalone build did not produce .next/standalone/server.js — check next.config.ts has the EVAL_BUILD gate (git pull?)");
}
if (!fs.existsSync(staticDir)) die("missing .next/static after build");
if (!fs.existsSync(devDb)) die("missing prisma/dev.db — run `npm run seed` first");
const wal = `${devDb}-wal`;
if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
  die("prisma/dev.db has a non-empty WAL sidecar; close anything using the DB (dev server?) so SQLite checkpoints, then re-run");
}

console.log(`Assembling evaluation package at ${outDir}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Runtime bundle: standalone output, then static assets + full public/ on
//    top (the standalone tracer only copies fs-read public files).
const appDir = path.join(outDir, "app");
fs.cpSync(standaloneDir, appDir, { recursive: true });
fs.rmSync(path.join(appDir, ".env"), { force: true }); // dev-oriented; start-eval.js sets env
fs.cpSync(staticDir, path.join(appDir, ".next", "static"), { recursive: true });
fs.cpSync(publicDir, path.join(appDir, "public"), { recursive: true });

// 2. Pre-seeded synthetic database.
fs.mkdirSync(path.join(outDir, "data"), { recursive: true });
fs.copyFileSync(devDb, path.join(outDir, "data", "dev.db"));

// 3. Strip stray third-party markdown (dependency READMEs) so the package
//    ships with no .md files at all.
const removedMd = [];
(function stripMd(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) stripMd(p);
    else if (entry.name.toLowerCase().endsWith(".md")) {
      fs.rmSync(p);
      removedMd.push(path.relative(outDir, p));
    }
  }
})(outDir);

// 4. Launcher + wrapper + client README.
const startEvalJs = `#!/usr/bin/env node
/*
 * Sleeptopia evaluation launcher.
 *
 * 1. Checks the evaluation window (valid through 2026-08-21, inclusive).
 *    After that it serves a friendly "this copy has expired" page instead of
 *    starting the app.
 * 2. Points the app at the bundled demo database (data/dev.db).
 * 3. Boots the pre-built server on http://localhost:3000.
 *
 * Internal testing only: set EVAL_NOW=YYYY-MM-DD to pretend today is another
 * date, e.g. \`EVAL_NOW=2026-08-22 node start-eval.js\` exercises the expired
 * path. Not documented for the recipient.
 */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const EXPIRY = "2026-08-21"; // last valid day, inclusive
const PORT = parseInt(process.env.PORT, 10) || 3000;

function todayISO() {
  const o = process.env.EVAL_NOW;
  if (o && /^\\d{4}-\\d{2}-\\d{2}$/.test(o)) return o;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

if (todayISO() > EXPIRY) {
  const message =
    "This evaluation copy has expired. Contact Ben Davis — Cato Consulting Group — for the current version.";
  console.log("");
  console.log("  " + message);
  console.log("");
  const page = [
    "<!doctype html><html><head><meta charset=\\"utf-8\\">",
    "<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">",
    "<title>Sleeptopia — evaluation expired</title>",
    "<style>body{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;",
    "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}",
    "main{max-width:34rem;text-align:center}h1{font-size:1.4rem;font-weight:600;margin-bottom:.75rem}",
    "p{line-height:1.6;color:#94a3b8}</style></head><body><main>",
    "<h1>This evaluation copy has expired</h1>",
    "<p>Thanks for taking the time to look at Sleeptopia. This evaluation window has ended.</p>",
    "<p>Contact <strong style=\\"color:#e2e8f0\\">Ben Davis — Cato Consulting Group</strong> for the current version.</p>",
    "</main></body></html>",
  ].join("");
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page);
    })
    .listen(PORT, "127.0.0.1", () => {
      console.log("  Details: http://localhost:" + PORT);
      console.log("");
    });
} else {
  const dbPath = path.join(__dirname, "data", "dev.db");
  if (!fs.existsSync(dbPath)) {
    console.error("Could not find the bundled database (data/dev.db).");
    console.error("Please re-extract the Sleeptopia folder from the zip and try again.");
    process.exit(1);
  }
  // Absolute path with forward slashes works for SQLite on macOS and Windows.
  process.env.DATABASE_URL = "file:" + dbPath.split(path.sep).join("/");
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = "127.0.0.1"; // local-only; also avoids inheriting a machine hostname
  process.env.NODE_ENV = "production";

  console.log("");
  console.log("  Starting Sleeptopia (evaluation copy)...");
  console.log("  Once it says \\"Ready\\", open http://localhost:" + PORT + " in your browser.");
  console.log("  Keep this window open while you explore; close it when you're done.");
  console.log("");
  require(path.join(__dirname, "app", "server.js"));
}
`;

const macCommand = `#!/bin/bash
# Sleeptopia evaluation launcher (macOS). Double-click to start.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Sleeptopia needs Node.js, which isn't installed yet."
  echo "  It's a quick, free, one-time install — opening nodejs.org now."
  echo "  Please download the LTS version, install it, then double-click"
  echo "  this launcher again."
  echo ""
  open "https://nodejs.org/"
  read -r -p "  Press Return to close this window... "
  exit 1
fi

NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
if ! [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
  echo ""
  echo "  Your Node.js version ($(node -v)) is older than Sleeptopia needs (20+)."
  echo "  Opening nodejs.org — please install the current LTS version, then"
  echo "  double-click this launcher again."
  echo ""
  open "https://nodejs.org/"
  read -r -p "  Press Return to close this window... "
  exit 1
fi

# Open the browser once the server answers (up to ~30s), then hand over.
(
  for _ in $(seq 1 30); do
    sleep 1
    if curl -s -o /dev/null "http://localhost:3000"; then
      open "http://localhost:3000"
      exit 0
    fi
  done
  open "http://localhost:3000"
) &

node start-eval.js
`;

// Windows launcher — note CRLF line endings, cmd.exe needs them.
const winBat = [
  "@echo off",
  "title Sleeptopia",
  'cd /d "%~dp0"',
  "",
  "where node >nul 2>nul",
  "if errorlevel 1 (",
  "  echo.",
  "  echo   Sleeptopia needs Node.js, which isn't installed yet.",
  "  echo   It's a quick, free, one-time install - opening nodejs.org now.",
  "  echo   Please download the LTS version, install it, then double-click",
  "  echo   this launcher again.",
  "  echo.",
  "  start https://nodejs.org/",
  "  pause",
  "  exit /b 1",
  ")",
  "",
  'for /f "tokens=1 delims=." %%a in (\'node -v\') do set NODE_MAJOR=%%a',
  "set NODE_MAJOR=%NODE_MAJOR:v=%",
  "if %NODE_MAJOR% LSS 20 (",
  "  echo.",
  "  echo   Your Node.js version is older than Sleeptopia needs ^(20 or newer^).",
  "  echo   Opening nodejs.org - please install the current LTS version, then",
  "  echo   double-click this launcher again.",
  "  echo.",
  "  start https://nodejs.org/",
  "  pause",
  "  exit /b 1",
  ")",
  "",
  'start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"',
  "node start-eval.js",
  "pause",
  "",
].join("\r\n");

const readme = `READ ME FIRST — Sleeptopia evaluation copy
==========================================

Hi Kevin,

This folder holds a private evaluation copy of the Sleeptopia demo so you
can explore it on your own computer, at your own pace. Everything in it is
synthetic demo data — there are no real people or real health records
anywhere in this package.

ONE-TIME SETUP (about 2 minutes)
--------------------------------
The app runs on Node.js, a free tool from nodejs.org. If you don't have it
yet (the launcher will tell you if not):

  1. Go to https://nodejs.org
  2. Download the LTS version (the big green button) for your computer —
     it covers both Mac and Windows.
  3. Run the installer and accept the defaults.

STARTING SLEEPTOPIA
-------------------
  On a Mac:       double-click  "Start Sleeptopia (Mac).command"
  On Windows:     double-click  "Start Sleeptopia (Windows).bat"

A small window opens while the app starts (10–20 seconds the first time),
and your browser should open to the app automatically. If it doesn't, open
your browser and go to:

    http://localhost:3000

Keep the small window open while you explore — closing it stops the app.

  * Mac note: if macOS says the launcher "can't be opened", right-click
    (or Control-click) it and choose "Open", then "Open" again. That's a
    standard safety prompt for downloaded files.
  * Windows note: if a blue "Windows protected your PC" screen appears,
    click "More info" and then "Run anyway".

FINDING YOUR WAY AROUND
-----------------------
Start on the home page and look for the "Demo map" pill in the bottom-right
corner of the screen — it lists the main stops in a sensible order and takes
you straight to each one. Click around freely; you can't break anything, and
restarting the launcher brings everything back.

GOOD TO KNOW
------------
  * This evaluation copy is valid through August 21, 2026. After that
    it will ask you to get in touch for the current version.
  * Questions, thoughts, anything odd? I'd love to hear it.

    Ben Davis
    Cato Consulting Group
    ben@catoconsultinggroup.com

Evaluation copy — property of Cato Consulting Group / Ben Davis.
Please don't redistribute.
`;

fs.writeFileSync(path.join(outDir, "start-eval.js"), startEvalJs);
fs.writeFileSync(path.join(outDir, "Start Sleeptopia (Mac).command"), macCommand, { mode: 0o755 });
fs.writeFileSync(path.join(outDir, "Start Sleeptopia (Windows).bat"), winBat);
fs.writeFileSync(path.join(outDir, "READ ME FIRST.txt"), readme);

// 5. Verify the assembled package.
const problems = [];
for (const engine of [
  "libquery_engine-darwin-arm64.dylib.node",
  "libquery_engine-darwin.dylib.node",
  "query_engine-windows.dll.node",
]) {
  const p = path.join(appDir, "node_modules", ".prisma", "client", engine);
  if (!fs.existsSync(p)) problems.push(`missing Prisma engine ${engine}`);
}
if (fs.existsSync(path.join(appDir, "src")) || fs.existsSync(path.join(outDir, "src"))) {
  problems.push("package contains a src/ directory");
}
const strayMd = [];
(function findMd(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) findMd(p);
    else if (entry.name.toLowerCase().endsWith(".md")) strayMd.push(p);
  }
})(outDir);
if (strayMd.length) problems.push(`markdown files remain: ${strayMd.join(", ")}`);
const mode = fs.statSync(path.join(outDir, "Start Sleeptopia (Mac).command")).mode;
if (!(mode & 0o111)) problems.push(".command launcher is not executable");

if (problems.length) die(problems.join("; "));

console.log(`  removed ${removedMd.length} third-party .md file(s): ${removedMd.join(", ") || "none"}`);
console.log("  verified: darwin-arm64 / darwin / windows Prisma engines present");
console.log("  verified: no src/, no *.md, launcher exec bit set");
console.log("");
// Zip it (exec bit preserved) and reveal the result.
const distDir = path.dirname(outDir);
const zipPath = path.join(distDir, "sleeptopia-eval.zip");
fs.rmSync(zipPath, { force: true });
execSync(`zip -ryq sleeptopia-eval.zip ${JSON.stringify(path.basename(outDir))}`, {
  cwd: distDir,
  stdio: "inherit",
});
const zipMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(0);
console.log("=".repeat(60));
console.log(`  DONE - sleeptopia-eval.zip is ready (${zipMb} MB)`);
console.log(`  Location: ${zipPath}`);
console.log("  Drag that one file into the Google Drive folder.");
console.log("=".repeat(60));
if (process.platform === "darwin") {
  try { execSync(`open ${JSON.stringify(distDir)}`); } catch {}
}
