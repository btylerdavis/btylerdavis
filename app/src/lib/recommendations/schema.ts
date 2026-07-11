import { z } from "zod";

/**
 * Schema-constrained output (audit level-up 12): the RecommendationDraft
 * JSON schema every generation engine must satisfy — the deterministic
 * template engine today, any future governed LLM tomorrow. The pipeline
 * validates every draft BEFORE the safety chain runs and before anything
 * renders; a draft that fails the schema is withheld and logged, never
 * shown. `.strict()` rejects unknown keys, so a model cannot smuggle
 * unreviewed fields past the validator.
 */

export const GUARDRAIL_CLASS_VALUES = [
  "comfort",
  "adherence-support",
  "discuss-with-provider",
] as const;

export const SPARKLINE_VALUES = ["supine", "usage", "leak", "residual"] as const;

export const RecommendationDraftSchema = z
  .object({
    /** generation engine id — "templates-v1" today */
    model: z.string().min(1),
    modelVersion: z.string().min(1),
    /** must name a registered rule (the guardrail-class check verifies it) */
    ruleId: z.string().min(1),
    guardrail: z.enum(GUARDRAIL_CLASS_VALUES),
    title: z.string().min(10).max(140),
    /** warm plain language; length bounds keep cards card-sized */
    body: z.string().min(40).max(1200),
    /** the drafted narrative (multi-sentence preview) */
    narrative: z.string().min(40).max(2400),
    whyChips: z
      .array(
        z
          .object({
            label: z.string().min(1).max(80),
            value: z.string().min(1).max(120),
          })
          .strict()
      )
      .min(1)
      .max(6),
    /** every claim the card cites — checked against the EvidenceBundle */
    evidenceClaimIds: z.array(z.string().min(1)).min(1).max(12),
    sparkline: z.enum(SPARKLINE_VALUES).nullable(),
  })
  .strict();

export type RecommendationDraft = z.infer<typeof RecommendationDraftSchema>;

export type DraftValidation =
  | { ok: true; draft: RecommendationDraft }
  | { ok: false; errors: string[] };

/** Validates a candidate draft; errors are compact "path: message" strings. */
export function validateRecommendationDraft(candidate: unknown): DraftValidation {
  const parsed = RecommendationDraftSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, draft: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
    ),
  };
}
