import path from "node:path";

// Point every test worker at the test database BEFORE src/lib/db.ts is
// imported (setup files run ahead of test-file imports).
process.env.DATABASE_URL = `file:${path.join(process.cwd(), "prisma", "test.db")}`;
