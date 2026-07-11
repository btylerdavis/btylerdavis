import { prisma } from "../db";
import type { SafetyCheck } from "./safety";

/**
 * ModelDecisionLog persistence (audit level-up 12) — the ONLY file in the
 * recommendations module that touches prisma (approved in the ESLint policy
 * boundary, same pattern as the disclosure release ledger). One row per
 * rendered card per engine version per sim date: model id + version, zod
 * schema validity, every SafetyCheck outcome, and the clinician-review stub
 * for provider-class cards. Rows are audit facts: recording the same
 * (participant, rule, model, version, simDate) again returns the existing
 * row instead of duplicating or mutating it.
 */

export interface ModelDecisionInput {
  participantId: string;
  ruleId: string;
  guardrail: string;
  model: string;
  modelVersion: string;
  schemaValid: boolean;
  checks: SafetyCheck[];
  passed: boolean;
  simDate: Date;
}

export interface ModelDecisionRecord {
  id: string;
  participantId: string;
  ruleId: string;
  guardrail: string;
  model: string;
  modelVersion: string;
  schemaValid: boolean;
  checks: SafetyCheck[];
  passed: boolean;
  simDate: Date;
  reviewQueued: boolean;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

function parseChecks(json: string): SafetyCheck[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as SafetyCheck[]) : [];
  } catch {
    return [];
  }
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.modelDecisionLog.findFirst>>>;

function toRecord(row: Row): ModelDecisionRecord {
  return { ...row, checks: parseChecks(row.checks) };
}

/**
 * Records one card's pipeline decision (idempotent per unique key). The
 * first render of a card on a given sim date creates the audit row —
 * provider-class cards enter the clinician-review queue at that moment —
 * and every re-render of the same card returns that same row untouched.
 */
export async function recordModelDecision(
  input: ModelDecisionInput
): Promise<ModelDecisionRecord> {
  const where = {
    participantId_ruleId_model_modelVersion_simDate: {
      participantId: input.participantId,
      ruleId: input.ruleId,
      model: input.model,
      modelVersion: input.modelVersion,
      simDate: input.simDate,
    },
  };
  const existing = await prisma.modelDecisionLog.findUnique({ where });
  if (existing) return toRecord(existing);
  try {
    const created = await prisma.modelDecisionLog.create({
      data: {
        participantId: input.participantId,
        ruleId: input.ruleId,
        guardrail: input.guardrail,
        model: input.model,
        modelVersion: input.modelVersion,
        schemaValid: input.schemaValid,
        checks: JSON.stringify(input.checks),
        passed: input.passed,
        simDate: input.simDate,
        reviewQueued: input.guardrail === "discuss-with-provider",
      },
    });
    return toRecord(created);
  } catch (error) {
    // Unique-constraint race with a concurrent render: the row exists now.
    if ((error as { code?: string }).code === "P2002") {
      const row = await prisma.modelDecisionLog.findUnique({ where });
      if (row) return toRecord(row);
    }
    throw error;
  }
}

/** Newest-first log page for /compliance/model-log (read-only table). */
export async function listModelDecisions(
  limit = 200
): Promise<{ entries: ModelDecisionRecord[]; total: number; queuedForReview: number }> {
  const [rows, total, queuedForReview] = await Promise.all([
    prisma.modelDecisionLog.findMany({
      orderBy: [{ createdAt: "desc" }, { ruleId: "asc" }],
      take: limit,
    }),
    prisma.modelDecisionLog.count(),
    prisma.modelDecisionLog.count({ where: { reviewQueued: true, reviewedAt: null } }),
  ]);
  return { entries: rows.map(toRecord), total, queuedForReview };
}

/**
 * Clinician-review stub (demo): marks a queued provider-class row reviewed.
 * Conditional update — a row that is not queued, or was already reviewed,
 * is left untouched and reported as such.
 */
export async function markDecisionReviewed(
  id: string,
  reviewer: string,
  reviewedAt: Date
): Promise<{ ok: boolean; reason?: string }> {
  const { count } = await prisma.modelDecisionLog.updateMany({
    where: { id, reviewQueued: true, reviewedAt: null },
    data: { reviewedBy: reviewer, reviewedAt },
  });
  if (count === 1) return { ok: true };
  const row = await prisma.modelDecisionLog.findUnique({ where: { id } });
  if (!row) return { ok: false, reason: "Unknown log entry" };
  if (!row.reviewQueued) return { ok: false, reason: "Not a provider-class card — no review queue" };
  return { ok: false, reason: `Already reviewed by ${row.reviewedBy ?? "someone"}` };
}
