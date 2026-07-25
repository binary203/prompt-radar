import { describe, expect, it } from "vitest";
import { calculateRoi } from "../../src/lib/analytics/roi";

describe("calculateRoi", () => {
  it("matches the methodology example and keeps fixed/token costs separate", () => {
    const result = calculateRoi({
      requestCount: 15_000,
      manualMinutesPerRequest: 15,
      outcome: {
        successRate: { low: 0.5, base: 0.7, high: 0.85 },
        repeatRate: { low: 0.2, base: 0.1, high: 0.05 },
        reviewTax: { low: 0.5, base: 0.3, high: 0.15 },
        feedbackFactor: { low: 0.9, base: 0.95, high: 0.98 },
      },
      totalTokens: 500_000_000,
      tokenCostPerThousand: 4.34,
      fixedCosts: { team: 1_000_000 },
    });

    expect(result.base.potentialValue).toBeCloseTo(9_375_000, 0);
    expect(result.base.outcomeYield).toBeCloseTo(0.41895, 5);
    expect(result.base.realizedValue).toBeCloseTo(3_927_656.25, 2);
    expect(result.tco).toMatchObject({
      tokenCost: 2_170_000,
      fixedCost: 1_000_000,
      total: 3_170_000,
    });
    expect(result.base.roi).toBeCloseTo(0.239, 2);
  });

  it("never emits Infinity or NaN when TCO is zero", () => {
    const result = calculateRoi({
      requestCount: 10,
      manualMinutesPerRequest: 5,
      outcome: {
        successRate: 1,
        repeatRate: 0,
        reviewTax: 0,
        feedbackFactor: 1,
      },
    });

    expect(result.tco.total).toBe(0);
    expect(result.base.roi).toBeNull();
    expect(result.base.returnPerRuble).toBeNull();
    expect(result.base.costPerSuccessfulOutcome).toBe(0);
    expect(
      Object.values(result.base)
        .filter((value): value is number => typeof value === "number")
        .every(Number.isFinite),
    ).toBe(true);
  });
});
