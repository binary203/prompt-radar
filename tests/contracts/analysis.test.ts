import demoAnalysis from "../../src/data/demo-analysis.json";
import { analysisResultSchema } from "../../src/lib/contracts/analysis";
import { describe, expect, it } from "vitest";

describe("AnalysisResult contract", () => {
  it("accepts the shared demo result", () => {
    const result = analysisResultSchema.safeParse(demoAnalysis);

    expect(result.success).toBe(true);
  });

  it("rejects rates outside the 0..1 range", () => {
    const invalid = structuredClone(demoAnalysis);
    invalid.overview.problemRate = 1.5;

    const result = analysisResultSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });
});
