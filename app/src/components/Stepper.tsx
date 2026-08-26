/**
 * The step pattern in the new design language: a brand-blue eyebrow over a
 * serif "Step N:" label, adapted as a flow progress header for the
 * enrollment doors.
 */
export function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <p className="font-display text-lg font-semibold">
      <span className="text-lake">Step {n}:</span>{" "}
      <span className="text-navy">{title}</span>
    </p>
  );
}

export function FlowProgress({
  steps,
  current,
  eyebrow,
}: {
  steps: readonly string[];
  current: number;
  eyebrow?: string;
}) {
  return (
    <div className="space-y-2">
      {eyebrow && (
        <p className="eyebrow">{eyebrow}</p>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <StepLabel n={current + 1} title={steps[current]} />
        <span className="text-xs whitespace-nowrap text-graphite">
          {current + 1} of {steps.length}
        </span>
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {steps.map((step, i) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= current ? "bg-brand" : "bg-hairline"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
