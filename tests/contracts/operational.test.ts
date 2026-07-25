import {
  economicsAssumptionsSchema,
  orderedValueRangeSchema,
  operationalEventSchema,
} from "../../src/lib/contracts/operational";
import { describe, expect, it } from "vitest";

describe("operational log contracts", () => {
  it("accepts an OpenAI-compatible event with trace metadata", () => {
    const result = operationalEventSchema.safeParse({
      id: "event-1",
      createdAt: "2026-07-25T08:00:00.000Z",
      userId: "user-1",
      userRole: "Менеджер",
      department: "Продажи",
      agentName: "agent_platform",
      request: {
        model: "local-model",
        messages: [{ role: "user", content: "Собери отчёт по тендерам" }],
      },
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
      },
      latencyMs: 850,
      toolCalls: [
        { name: "crm_search", status: "success", durationMs: 240 },
      ],
      outcome: "success",
      feedback: 1,
    });

    expect(result.success).toBe(true);
  });

  it("keeps the CROC FTE price while defaulting editable assumptions", () => {
    const assumptions = economicsAssumptionsSchema.parse({});

    expect(assumptions.monthlyFteCostRub).toBe(400_000);
    expect(assumptions.workingHoursPerMonth).toBe(160);
  });

  it("rejects inverted uncertainty ranges", () => {
    const result = orderedValueRangeSchema.safeParse({
      low: 10,
      base: 8,
      high: 12,
    });

    expect(result.success).toBe(false);
  });

  it("accepts pessimistic review tax as low/base/high scenario bands", () => {
    const result = economicsAssumptionsSchema.safeParse({
      reviewRate: { low: 0.5, base: 0.3, high: 0.15 },
    });

    expect(result.success).toBe(true);
  });
});
