import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Creates a fresh SQLite test database with the current schema. The stale
 * test.db is removed first so a plain (non-destructive) `db push` suffices.
 */
export default function globalSetup() {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const dbPath = path.join(rootDir, "prisma", "test.db");
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-journal`, { force: true });
  execSync("npx prisma db push --skip-generate", {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "inherit",
  });
}
