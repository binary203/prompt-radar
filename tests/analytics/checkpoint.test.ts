import { describe, expect, it } from "vitest";

import taxonomyData from "../../src/data/synthetic/taxonomy.json";
import { buildCheckpoint } from "../../src/lib/analytics/checkpoint";
import type { Taxonomy } from "../../src/lib/analytics/classifier";
import type { OperationalEvent } from "../../src/lib/contracts/operational";

const taxonomy = taxonomyData as Taxonomy;

function event(overrides: Partial<OperationalEvent> = {}): OperationalEvent {
  return {
    id: "evt_1",
    createdAt: "2026-06-01T09:00:00.000Z",
    userId: "u1",
    userRole: "менеджер по продажам",
    department: "Продажи",
    agentName: "internal_copilot",
    request: {
      model: "corporate-assistant",
      messages: [
        { role: "user", content: "сделай сводку по входящей почте за день" },
      ],
    },
    usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
    latencyMs: 1_500,
    toolCalls: [{ name: "mail.list", status: "success", durationMs: 200 }],
    outcome: "success",
    feedback: 0,
    ...overrides,
  };
}

/**
 * The path an uploaded log takes: no gold labels, no RAG sample, agent names
 * the demo dataset has never seen.
 */
describe("buildCheckpoint on an arbitrary log", () => {
  it("produces a full checkpoint without gold labels", async () => {
    const checkpoint = await buildCheckpoint({
      events: [
        event(),
        event({
          id: "evt_2",
          createdAt: "2026-06-02T09:00:00.000Z",
          agentName: "field_agent",
          outcome: "error",
        }),
        event({
          id: "evt_3",
          createdAt: "2026-06-02T09:10:00.000Z",
          agentName: "field_agent",
          repeatOf: "evt_2",
          outcome: "success",
        }),
      ],
      taxonomy,
      sourceLabel: "uploaded.jsonl",
    });

    expect(checkpoint.source).toBe("uploaded.jsonl");
    expect(checkpoint.dataset.events).toBe(3);
    // The retry collapses into its original task.
    expect(checkpoint.dataset.tasks).toBe(2);
    expect(Object.keys(checkpoint.agents).sort()).toEqual([
      "field_agent",
      "internal_copilot",
    ]);
    expect(checkpoint.intentExtractionDemo).toBeNull();
    // No gold set means nothing is claimed about accuracy.
    expect(checkpoint.evaluation.evaluated).toBe(0);
    expect(checkpoint.problems.rows.length).toBeGreaterThan(0);
    expect(checkpoint.pipeline.layers).toHaveLength(5);
  });

  it("prorates fixed cost by the period the log actually covers", async () => {
    const oneDay = await buildCheckpoint({
      events: [event(), event({ id: "evt_2" })],
      taxonomy,
    });
    const twoMonths = await buildCheckpoint({
      events: [
        event(),
        event({ id: "evt_2", createdAt: "2026-07-31T09:00:00.000Z" }),
      ],
      taxonomy,
    });

    expect(twoMonths.economics.tcoRub.fixedCost).toBeGreaterThan(
      oneDay.economics.tcoRub.fixedCost * 10,
    );
  });

  it("survives a log with a single event", async () => {
    const checkpoint = await buildCheckpoint({ events: [event()], taxonomy });

    expect(checkpoint.dataset.tasks).toBe(1);
    expect(Number.isFinite(checkpoint.economics.tcoRub.total)).toBe(true);
    expect(checkpoint.discovery.clusters).toEqual([]);
  });
});
