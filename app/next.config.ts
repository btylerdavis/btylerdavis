import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Pin the tracing root to this app directory. Without this, a stray
// lockfile in a parent folder (e.g. ~/package-lock.json on a dev machine)
// makes Next infer a larger workspace root and nest the standalone output,
// which breaks the eval packager's layout assumptions.
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: appRoot,
  // EVAL_BUILD=1 produces a self-contained standalone bundle for the client
  // evaluation package (see scripts/package-eval.mjs). Images are served
  // unoptimized in that bundle (only the SVG logos use next/image) so the
  // package has no sharp native-binary dependency on the client's platform.
  // Normal `next dev` / `next build` behavior is unchanged when EVAL_BUILD
  // is unset.
  ...(process.env.EVAL_BUILD === "1"
    ? { output: "standalone" as const, images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
