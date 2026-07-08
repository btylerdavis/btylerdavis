/**
 * The discreet "DEMO DATA" chip (DEMO.md §1) — fixed bottom-right on every
 * page via the root layout. Every screen Kevin touches carries it.
 */
export function DemoWatermark() {
  return (
    <div
      aria-label="Demo data — synthetic cohort"
      className="pointer-events-none fixed right-3 bottom-3 z-50 rounded-full border border-watermark/50 bg-white/85 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-watermark uppercase backdrop-blur-sm"
    >
      Demo data
    </div>
  );
}
