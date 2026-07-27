import { describe, expect, it } from "vitest";
import { rollupTasks } from "../../src/lib/analytics/tasks";

describe("rollupTasks", () => {
  it("collapses a retry chain into one task and keeps the final outcome", () => {
    const rollup = rollupTasks([
      {
        id: "a",
        createdAt: "2026-06-01T09:00:00.000Z",
        outcome: "error",
        scenarioIds: ["email_digest"],
      },
      {
        id: "a-retry-1",
        createdAt: "2026-06-01T09:05:00.000Z",
        outcome: "error",
        repeatOf: "a",
        scenarioIds: ["email_digest"],
      },
      {
        id: "a-retry-2",
        createdAt: "2026-06-01T09:11:00.000Z",
        outcome: "success",
        repeatOf: "a-retry-1",
        scenarioIds: ["knowledge_search"],
      },
    ]);

    expect(rollup.taskCount).toBe(1);
    expect(rollup.attempts).toBe(3);
    expect(rollup.succeeded).toBe(1);
    expect(rollup.reworked).toBe(1);
    expect(rollup.attemptsPerTask).toBe(3);
    // The scenario comes from the first attempt, the outcome from the last.
    expect(Object.keys(rollup.perScenario)).toEqual(["email_digest"]);
  });

  it("counts independent requests separately", () => {
    const rollup = rollupTasks([
      { id: "a", createdAt: "2026-06-01T09:00:00.000Z", outcome: "success" },
      { id: "b", createdAt: "2026-06-01T10:00:00.000Z", outcome: "error" },
    ]);

    expect(rollup.taskCount).toBe(2);
    expect(rollup.successRate).toBe(0.5);
    expect(rollup.reworkRate).toBe(0);
    expect(rollup.perScenario.unknown.taskCount).toBe(2);
  });

  it("survives a missing parent and a cyclic repeatOf", () => {
    const rollup = rollupTasks([
      {
        id: "orphan",
        createdAt: "2026-06-01T09:00:00.000Z",
        outcome: "success",
        repeatOf: "missing",
      },
      {
        id: "loop-a",
        createdAt: "2026-06-01T09:00:00.000Z",
        outcome: "error",
        repeatOf: "loop-b",
      },
      {
        id: "loop-b",
        createdAt: "2026-06-01T09:01:00.000Z",
        outcome: "error",
        repeatOf: "loop-a",
      },
    ]);

    expect(rollup.taskCount).toBeGreaterThan(0);
    expect(Number.isFinite(rollup.attemptsPerTask)).toBe(true);
  });
});
