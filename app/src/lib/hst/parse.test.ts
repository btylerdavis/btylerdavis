import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertValidParsedHst,
  HstParseError,
  isSupinePredominant,
  parseHst,
  parseHstCsv,
  parseHstReport,
} from "./parse";

const FIXTURE_DIR = path.join(process.cwd(), "public", "demo-fixtures");
const csvText = readFileSync(path.join(FIXTURE_DIR, "hst-sample.csv"), "utf8");
const reportText = readFileSync(
  path.join(FIXTURE_DIR, "hst-sample-report.txt"),
  "utf8"
);

const EXPECTED_VALUES = {
  ahi: 24.0,
  supine_ahi: 41.0,
  nonsupine_ahi: 9.8,
  odi: 19.2,
  spo2_mean: 93.8,
  spo2_nadir: 84.0,
  supine_time_pct: 52.0,
};

describe("HST parsing — structured CSV fixture", () => {
  it("extracts every metric and the study date", () => {
    const parsed = parseHstCsv(csvText);
    expect(parsed.format).toBe("csv");
    expect(parsed.studyDate).toBe("2026-04-08");
    expect(parsed.values).toEqual(EXPECTED_VALUES);
  });

  it("auto-detects CSV via parseHst", () => {
    expect(parseHst(csvText).format).toBe("csv");
  });

  it("handles shuffled column order", () => {
    const shuffled = [
      "ahi,study_date,supine_time_pct,supine_ahi,nonsupine_ahi,odi,spo2_mean,spo2_nadir",
      "24.0,2026-04-08,52.0,41.0,9.8,19.2,93.8,84.0",
    ].join("\n");
    expect(parseHstCsv(shuffled).values).toEqual(EXPECTED_VALUES);
  });

  it("rejects a CSV missing a required column", () => {
    const missing = ["study_date,ahi", "2026-04-08,24.0"].join("\n");
    expect(() => parseHstCsv(missing)).toThrow(HstParseError);
    expect(() => parseHstCsv(missing)).toThrow(/Supine AHI/);
  });

  it("rejects implausible values", () => {
    const junk = csvText.replace("93.8", "993.8");
    expect(() => parseHstCsv(junk)).toThrow(/out of plausible range/);
  });
});

describe("HST parsing — plain-text report fixture", () => {
  it("extracts every metric and the study date via regex", () => {
    const parsed = parseHstReport(reportText);
    expect(parsed.format).toBe("report");
    expect(parsed.studyDate).toBe("2026-04-08");
    expect(parsed.values).toEqual(EXPECTED_VALUES);
  });

  it("auto-detects the report format via parseHst", () => {
    expect(parseHst(reportText).format).toBe("report");
  });

  it("does not confuse supine and non-supine AHI", () => {
    const parsed = parseHstReport(reportText);
    expect(parsed.values.supine_ahi).toBe(41.0);
    expect(parsed.values.nonsupine_ahi).toBe(9.8);
    expect(parsed.values.ahi).toBe(24.0);
  });

  it("parses long-form study dates", () => {
    const altered = reportText.replace("2026-04-08", "April 8, 2026");
    expect(parseHstReport(altered).studyDate).toBe("2026-04-08");
  });

  it("names the missing metrics when extraction fails", () => {
    const truncated = reportText.replace(/OXIMETRY[\s\S]*$/, "");
    expect(() => parseHstReport(truncated)).toThrow(HstParseError);
    expect(() => parseHstReport(truncated)).toThrow(/Mean SpO2/);
  });
});

describe("positional-OSA flag", () => {
  it("flags supine AHI at least 2x non-supine", () => {
    expect(isSupinePredominant({ supine_ahi: 41, nonsupine_ahi: 9.8 })).toBe(true);
    expect(isSupinePredominant({ supine_ahi: 20, nonsupine_ahi: 10 })).toBe(true);
  });

  it("does not flag balanced OSA", () => {
    expect(isSupinePredominant({ supine_ahi: 18, nonsupine_ahi: 10 })).toBe(false);
  });

  it("both fixtures produce the flagged Marcus phenotype", () => {
    expect(isSupinePredominant(parseHst(csvText).values)).toBe(true);
    expect(isSupinePredominant(parseHst(reportText).values)).toBe(true);
  });
});

describe("assertValidParsedHst (server-side re-validation)", () => {
  it("accepts a round-tripped parse result", () => {
    const parsed = parseHst(csvText);
    expect(assertValidParsedHst(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects tampered values", () => {
    const parsed = parseHst(csvText);
    const tampered = { ...parsed, values: { ...parsed.values, ahi: -5 } };
    expect(() => assertValidParsedHst(tampered)).toThrow(HstParseError);
  });

  it("rejects a bad study date", () => {
    const parsed = parseHst(csvText);
    expect(() =>
      assertValidParsedHst({ ...parsed, studyDate: "not-a-date" })
    ).toThrow(/study date/i);
  });
});
