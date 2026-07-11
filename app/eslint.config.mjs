import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // -------------------------------------------------------------------------
  // Consent policy boundary (audit level-up 4): the raw Prisma client may
  // only be imported by the approved persistence layer — the consent
  // engine/gates/aggregates/policy repository, the compliance modules, the
  // identity service, the sim clock, the synthetic generator, and the two
  // consent-aware dashboard query builders. Product pages, server actions,
  // and feature modules must go through consent-gated readers, aggregates,
  // or the policy repository so no count or write can bypass policy.
  // -------------------------------------------------------------------------
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/db", "@/lib/db", "**/db"],
              message:
                "Raw prisma access is restricted to approved persistence modules " +
                "(src/lib/consent/**, src/lib/compliance/**, identity, simclock, " +
                "synthetic generator, research/cohort, coach/exec query builders). " +
                "Use the consent-gated readers, aggregates, or the policy repository.",
            },
          ],
        },
      ],
    },
  },
  {
    // Approved persistence modules + tests and the seed (fixture setup).
    files: [
      "src/lib/db.ts",
      "src/lib/consent/**",
      "src/lib/compliance/**",
      "src/lib/identity.ts",
      "src/lib/simclock.ts",
      "src/lib/synthetic/generator.ts",
      "src/lib/research/cohort.ts",
      "src/lib/research/savedCohorts.ts",
      "src/lib/coach/queries.ts",
      "src/lib/exec/queries.ts",
      "src/**/*.test.ts",
      "prisma/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
