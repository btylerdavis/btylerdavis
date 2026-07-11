import { describe, expect, it } from "vitest";
import { bandCount, COUNT_BANDS, withholdCount } from "./bands";

/**
 * Banded count release (audit F-12, level-up 10): exact counts never leave a
 * partner surface — every positive count maps onto the band ladder, small
 * cells stay suppressed, 0 (which describes no individual) releases as "0".
 */

describe("bandCount", () => {
  it("releases 0 exactly (an empty cell describes no individual)", () => {
    expect(bandCount(0)).toEqual({
      suppressed: false,
      band: "0",
      display: "0",
      min: 0,
      max: 0,
    });
  });

  it("suppresses every small cell 1..10 with the k<11 display", () => {
    for (const n of [1, 2, 5, 9, 10]) {
      const released = bandCount(n);
      expect(released.suppressed).toBe(true);
      expect(released.display).toBe("<11 (suppressed)");
      expect(released.min).toBe(1);
      expect(released.max).toBe(10);
    }
  });

  it("maps every count onto the exact band ladder edges", () => {
    expect(bandCount(11)).toMatchObject({ band: "11-20", display: "11–20", min: 11, max: 20 });
    expect(bandCount(20).band).toBe("11-20");
    expect(bandCount(21)).toMatchObject({ band: "21-50", display: "21–50", min: 21, max: 50 });
    expect(bandCount(50).band).toBe("21-50");
    expect(bandCount(51)).toMatchObject({ band: "51-200", display: "51–200", min: 51, max: 200 });
    expect(bandCount(200).band).toBe("51-200");
    expect(bandCount(201)).toMatchObject({ band: ">200", display: ">200", min: 201, max: null });
    expect(bandCount(1_000_000).band).toBe(">200");
  });

  it("never releases an exact positive count", () => {
    for (let n = 1; n <= 500; n++) {
      const released = bandCount(n);
      expect(released.display).not.toBe(String(n));
      // The admitted interval always contains the truth...
      expect(released.min).toBeLessThanOrEqual(n);
      if (released.max !== null) expect(released.max).toBeGreaterThanOrEqual(n);
      // ...and is never a single value.
      expect(released.max === null || released.max > released.min).toBe(true);
    }
  });

  it("rejects non-integer / negative inputs (fail closed)", () => {
    expect(() => bandCount(-1)).toThrow(/non-negative/);
    expect(() => bandCount(1.5)).toThrow(/non-negative integer/);
  });

  it("keeps the band ladder contiguous from 1 upward", () => {
    let next = 1;
    for (const band of COUNT_BANDS) {
      expect(band.min).toBe(next);
      if (band.max === null) break;
      next = band.max + 1;
    }
  });
});

describe("withholdCount (complementary suppression)", () => {
  it("admits any value — the widest possible interval", () => {
    const withheld = withholdCount();
    expect(withheld.suppressed).toBe(true);
    expect(withheld.min).toBe(0);
    expect(withheld.max).toBeNull();
    expect(withheld.display).toContain("complementary");
  });
});
