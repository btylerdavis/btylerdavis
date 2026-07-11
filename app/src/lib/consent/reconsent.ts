import { prisma } from "../db";
import {
  ceilingCoversClass,
  grantConsent,
  latestRecordsByInstrument,
  parseScopeJson,
  signedScopeCeiling,
  withConsentRetry,
} from "./engine";
import { INSTRUMENT_SCOPES } from "./scopes";
import {
  CONSENT_USES,
  INSTRUMENT_TYPES,
  LifecycleError,
  type ConsentScope,
  type DataClass,
  type InstrumentType,
} from "./types";

/**
 * Participant-facing RE-CONSENT (audit F-02, level-up 2): the ONLY way to
 * enable a data class the participant never signed for. It records a fresh
 * SIGNED grant event — which is what extends the authorized-scope ceiling —
 * scoped to the newly agreed class (plus whatever the chosen instrument
 * already carries, so nothing currently flowing is disturbed).
 *
 * Administrative surfaces (the revocation console's Restore buttons) can
 * never do this: their scope revisions are ceiling-bounded by the engine.
 */

export type ReconsentResult =
  | { ok: true; instrument: InstrumentType; dataClass: DataClass }
  | { ok: false; error: string };

/** The instrument a re-consent signature for this class attaches to. */
export function reconsentInstrumentFor(
  dataClass: DataClass,
  signedInstruments: ReadonlySet<InstrumentType>
): InstrumentType | null {
  const covering = INSTRUMENT_TYPES.filter((instrument) =>
    INSTRUMENT_SCOPES[instrument].some((grant) => grant.dataClass === dataClass)
  );
  if (covering.length === 0) return null;
  // Prefer an instrument the participant has signed before (a version bump
  // of a familiar document); otherwise the first covering template.
  return covering.find((instrument) => signedInstruments.has(instrument)) ?? covering[0];
}

export async function reconsentDataClass(
  participantId: string,
  dataClass: DataClass,
  signatureCaptured: boolean,
  opts: { grantedAt?: Date } = {}
): Promise<ReconsentResult> {
  if (!signatureCaptured) {
    return { ok: false, error: "A signature is required to expand data sharing" };
  }

  try {
    const instrument = await withConsentRetry(() =>
      prisma.$transaction(async (tx) => {
        const records = await tx.consentRecord.findMany({ where: { participantId } });
        const ceiling = signedScopeCeiling(records);
        if (ceilingCoversClass(ceiling, dataClass)) {
          throw new AlreadyAuthorized();
        }
        const signedInstruments = new Set<InstrumentType>(
          records.map((record) => record.instrumentType as InstrumentType)
        );
        const target = reconsentInstrumentFor(dataClass, signedInstruments);
        if (!target) throw new NoCoveringInstrument();

        // New signed scope: the class across all uses, merged with the
        // instrument's CURRENT scope when it is granted (so the fresh
        // signature carries the whole live agreement forward).
        const classGrants: ConsentScope = CONSENT_USES.map((use) => ({ dataClass, use }));
        const latest = latestRecordsByInstrument(records).get(target);
        const currentScope: ConsentScope =
          latest && latest.status === "granted" && latest.revokedAt === null
            ? parseScopeJson(latest.scope)
            : [];
        const merged: ConsentScope = [
          ...currentScope.filter((grant) => grant.dataClass !== dataClass),
          ...classGrants,
        ];

        // Signed grant event — extends the ceiling; lifecycle re-checked
        // inside this same transaction by the engine.
        await grantConsent(participantId, target, {
          grantedAt: opts.grantedAt,
          scope: merged,
          instrumentVersion: "1.1-reconsent",
          db: tx,
        });
        return target;
      })
    );
    return { ok: true, instrument, dataClass };
  } catch (error) {
    if (error instanceof AlreadyAuthorized) {
      return {
        ok: false,
        error:
          "This data class was already signed for — use the revocation console's Restore instead",
      };
    }
    if (error instanceof NoCoveringInstrument) {
      return { ok: false, error: "No consent instrument covers this data class" };
    }
    if (error instanceof LifecycleError) {
      return { ok: false, error: "This record was deleted — re-consent is not possible" };
    }
    throw error;
  }
}

class AlreadyAuthorized extends Error {}
class NoCoveringInstrument extends Error {}
