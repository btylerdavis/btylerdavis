import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Creates a fresh SQLite test database with the current schema. The stale
 * test.db is removed first so a plain (non-destructive) `db push` suffices.
 * The schema path is passed explicitly so the push works regardless of cwd
 * quirks or a missing/misconfigured .env.
 */
export default function globalSetup() {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(rootDir, "prisma", "schema.prisma");
  const dbPath = path.join(rootDir, "prisma", "test.db");
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-journal`, { force: true });
  try {
    execSync(`npx prisma db push --skip-generate --schema "${schemaPath}"`, {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      stdio: "inherit",
    });
  } catch (error) {
    const envPath = path.join(rootDir, ".env");
    console.error(
      [
        "",
        "vitest globalSetup: `prisma db push` failed — the test database could not be created.",
        `  schema:       ${schemaPath}`,
        `  test db:      file:${dbPath} (tests always run against prisma/test.db)`,
        `  node:         ${process.version} (Prisma 6 requires Node.js >= 18.18)`,
        `  DATABASE_URL: ${process.env.DATABASE_URL ?? "(unset — overridden to the test db above)"}`,
        existsSync(envPath)
          ? "  .env:         present"
          : "  .env:         MISSING — run `cp .env.example .env` in app/ and retry `npm test`",
        "  If prisma itself is missing, run `npm install` first (postinstall runs `prisma generate`).",
        "",
      ].join("\n")
    );
    throw error;
  }
}
