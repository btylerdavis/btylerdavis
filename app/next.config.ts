import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
