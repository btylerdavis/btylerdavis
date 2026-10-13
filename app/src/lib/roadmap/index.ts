import data from "./roadmap.json";

/**
 * The phase roadmap (Ben, Oct 13): source of truth for the /dashboard
 * tracker. The Kevin one-pager and the narrated video (scripts/video) say the
 * same things in shorter form; change all three together.
 */

export type ItemStatus = "planned" | "in-progress" | "live" | "done" | "future";
export type PhaseStatus = "proposed" | "active" | "closed" | "future";
export type Area = "real" | "smart" | "trust";

export interface RoadmapItem {
  id: string;
  title: string;
  detail: string;
  area: Area;
  status: ItemStatus;
}

export interface Phase {
  id: string;
  number: number;
  name: string;
  tagline: string;
  status: PhaseStatus;
  items: RoadmapItem[];
  exit: string[];
}

export interface Roadmap {
  updated: string;
  product: string;
  video?: { title: string; caption: string; url: string; poster: string };
  today: { label: string; headline: string; built: string[]; gaps: string[] };
  phases: Phase[];
  garmin: { phase: string; text: string }[];
  complete: { label: string; sentence: string; targets: string[]; kevinDefinition: string };
  decisions: { id: string; question: string; owner: string; status: "open" | "answered"; answer?: string }[];
  updates: { date: string; text: string }[];
}

export const roadmap = data as Roadmap;

/** Share of a phase's items that are live or done (0–1). */
export function phaseProgress(phase: Phase): number {
  if (phase.items.length === 0) return 0;
  const finished = phase.items.filter((i) => i.status === "live" || i.status === "done").length;
  return finished / phase.items.length;
}

export const AREA_LABELS: Record<Area, string> = {
  real: "Make it real",
  smart: "Make it smart",
  trust: "Make it trustworthy",
};

export const STATUS_LABELS: Record<ItemStatus, string> = {
  planned: "Planned",
  "in-progress": "In progress",
  live: "Live",
  done: "Done",
  future: "Later phase",
};
