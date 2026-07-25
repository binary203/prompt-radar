import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../../src/lib/analytics/aggregate";

describe("aggregateEvents", () => {
  it("aggregates totals, MAU, outcomes, agents, and multi-label scenarios", () => {
    const result = aggregateEvents([
      {
        id: "one",
        timestamp: "2026-06-05T10:00:00Z",
        userId: "u1",
        agentName: "copilot",
        scenarioIds: ["email_digest"],
        status: "success",
        inputTokens: 100,
        outputTokens: 20,
        toolCalls: [{ name: "mail.search", status: "success" }],
      },
      {
        id: "two",
        timestamp: "2026-06-12T10:00:00Z",
        userId: "u2",
        agentName: "copilot",
        scenarioIds: ["email_digest", "calendar_scheduling"],
        status: "error",
        isRepeat: true,
        inputTokens: 200,
        outputTokens: 30,
        toolCalls: 2,
      },
      {
        id: "three",
        createdAt: "2026-07-01T10:00:00Z",
        userId: "u1",
        agentName: "researcher",
        outcome: "unknown",
        usage: {
          inputTokens: 40,
          outputTokens: 10,
          totalTokens: 50,
        },
      },
    ]);

    expect(result).toMatchObject({
      requests: 3,
      activeUsers: 2,
      mau: 1.5,
      monthlyActiveUsers: { "2026-06": 2, "2026-07": 1 },
      toolCalls: 3,
      inputTokens: 340,
      outputTokens: 60,
      totalTokens: 400,
      successes: 1,
      partials: 0,
      errors: 1,
      unknownOutcomes: 1,
      successRate: 1 / 3,
      repeatRate: 1 / 3,
    });
    expect(result.perAgent.copilot.requests).toBe(2);
    expect(result.perScenario.email_digest.requests).toBe(2);
    expect(result.perScenario.calendar_scheduling.requests).toBe(1);
    expect(result.perScenario.unknown.requests).toBe(1);
  });

  it("returns stable zero rates for an empty dataset", () => {
    const result = aggregateEvents([]);

    expect(result.requests).toBe(0);
    expect(result.mau).toBe(0);
    expect(result.successRate).toBe(0);
    expect(result.repeatRate).toBe(0);
  });
});
