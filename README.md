# Sleeptopia × The Mattress Hub — Sleep Outcomes Data Platform

**Specification repository** · Version 0.1 (draft) · July 2026

Prepared by Ben Davis, Cato Consulting Group, for Kevin Kunz, Sleeptopia Inc. (Wichita, KS) and The Mattress Hub.

## What this is

A specification for a consented, HIPAA-grade **real-world sleep outcomes registry** that links clinical sleep-apnea data (home sleep tests, CPAP therapy telemetry, oral appliance therapy) with mattress, wearable, and patient-reported data — to prove which treatment combinations actually work, with a flagship research focus on **positional sleep apnea and mattress choice**.

The long-term value is not selling patient data. It is building a compliant, de-identifiable outcomes database that demonstrates what works — a durable competitive advantage for both partners.

## Documents

| Document | Audience | Contents |
|---|---|---|
| [SPEC.md](SPEC.md) | Kevin, The Mattress Hub, business partners, counsel | Vision, goals, legal/compliance architecture, data sources, study design, participant experience, partnerships, roadmap, risks |
| [TECHNICAL.md](TECHNICAL.md) | Development team | Integration specifications, data model, system architecture, security controls, build estimates |
| [DELIVERY.md](DELIVERY.md) | Kevin, partners, delivery team | Start-to-finish agent-accelerated build timeline, agent staffing plan, critical path |
| [EVALUATION.md](EVALUATION.md) | Partners, evaluation agents | Objective measurement criteria run by independent (non-build) agents: gate reviews, continuous checks, quarterly scorecard |

## How to read

- **Business readers**: SPEC.md end to end. Sections 1–4 (what and why, legal architecture), 9 (participant experience), and 12–14 (partnerships, roadmap, risks) matter most. A glossary is at the end.
- **Developers**: skim SPEC.md sections 3–8, then build from TECHNICAL.md, which is self-contained.
- **Counsel / IRB reviewers**: SPEC.md section 4 (Compliance & Legal Architecture) and section 14 (open questions assigned to counsel).

## Status

This is a draft for review. Open decisions — entity structure, IRB selection, wearable-aggregator vendor, and several counsel questions — are catalogued in SPEC.md §14 with proposed owners. Nothing in this repository is legal advice; §4 is a design for counsel to validate, not a substitute for it.
