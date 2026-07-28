import { describe, expect, it } from "vitest";

import {
  buildProblemGrid,
  type ProblemScenarioInput,
} from "../../src/lib/analytics/problems";

function events(count: number, overrides: Partial<{
  toolCalls: number;
  toolErrors: number;
  feedback: number | null;
  latencyMs: number;
}> = {}) {
  return Array.from({ length: count }, () => ({
    scenarioId: "s",
    toolCalls: overrides.toolCalls ?? 1,
    toolErrors: overrides.toolErrors ?? 0,
    feedback: overrides.feedback ?? null,
    latencyMs: overrides.latencyMs ?? 1_000,
  }));
}

function scenario(
  overrides: Partial<ProblemScenarioInput> = {},
): ProblemScenarioInput {
  return {
    key: "email_digest",
    title: "Сводка за день по почте",
    tasks: 100,
    failedTasks: 10,
    reworkedTasks: 5,
    valueGapRub: 1_000,
    events: events(100),
    ...overrides,
  };
}

describe("buildProblemGrid", () => {
  it("orders rows by the money they lose, not by how bad the rates look", () => {
    const rows = buildProblemGrid(
      [
        scenario({ key: "small", title: "Мелкий", valueGapRub: 10, failedTasks: 90 }),
        scenario({ key: "big", title: "Крупный", valueGapRub: 900_000 }),
      ],
      5_000,
    );

    expect(rows.map((row) => row.key)).toEqual(["big", "small"]);
  });

  it("flags the row that stands out from the log, not the log itself", () => {
    // Every scenario reworks a fifth of its tasks, so nothing stands out and a
    // fixed threshold would have painted the whole column red.
    const uniform = buildProblemGrid(
      [
        scenario({ key: "a", tasks: 100, reworkedTasks: 20 }),
        scenario({ key: "b", tasks: 100, reworkedTasks: 20 }),
        scenario({ key: "c", tasks: 100, reworkedTasks: 20 }),
      ],
      5_000,
    );

    for (const row of uniform) {
      expect(row.cells.find((cell) => cell.key === "rework")?.severity).toBe(
        "ok",
      );
    }

    const withOutlier = buildProblemGrid(
      [
        scenario({ key: "a", tasks: 100, reworkedTasks: 5 }),
        scenario({ key: "b", tasks: 100, reworkedTasks: 5 }),
        scenario({ key: "bad", tasks: 100, reworkedTasks: 40, valueGapRub: 9_000 }),
      ],
      5_000,
    );
    const bad = withOutlier.find((row) => row.key === "bad");

    expect(bad?.cells.find((cell) => cell.key === "rework")?.severity).toBe(
      "act",
    );
    expect(bad?.worst).toBe("rework");
  });

  it("stays quiet when the absolute rate is negligible", () => {
    // Ten times the baseline, but the baseline is a rounding error.
    const rows = buildProblemGrid(
      [
        scenario({ key: "a", tasks: 1_000, reworkedTasks: 1 }),
        scenario({ key: "b", tasks: 1_000, reworkedTasks: 10 }),
      ],
      5_000,
    );

    for (const row of rows) {
      expect(row.cells.find((cell) => cell.key === "rework")?.severity).toBe(
        "ok",
      );
    }
  });

  it("will not demand action on a handful of observations", () => {
    const rows = buildProblemGrid(
      [
        scenario({ key: "normal", tasks: 400, failedTasks: 40, reworkedTasks: 20 }),
        scenario({
          key: "tiny",
          tasks: 3,
          failedTasks: 3,
          reworkedTasks: 3,
          events: events(3),
        }),
      ],
      5_000,
    );
    const row = rows.find((candidate) => candidate.key === "tiny")!;

    for (const cell of row.cells) {
      expect(cell.severity).not.toBe("act");
    }
    // The counts stay visible even when the verdict is withheld.
    expect(row.cells.find((cell) => cell.key === "noResult")?.denominator).toBe(3);
  });

  it("counts negative feedback against rated answers only", () => {
    const [row] = buildProblemGrid(
      [
        scenario({
          key: "rated",
          events: [
            ...events(30, { feedback: null }),
            ...events(6, { feedback: -1 }),
            ...events(14, { feedback: 1 }),
          ],
        }),
      ],
      5_000,
    );
    const feedback = row.cells.find(
      (cell) => cell.key === "negativeFeedback",
    );

    expect(feedback?.denominator).toBe(20);
    expect(feedback?.rate).toBeCloseTo(0.3, 10);
  });

  it("reports a scenario in line with the log as having nothing to fix", () => {
    const rows = buildProblemGrid(
      [
        scenario({ key: "a", failedTasks: 25, reworkedTasks: 8 }),
        scenario({ key: "b", failedTasks: 25, reworkedTasks: 8 }),
      ],
      5_000,
    );

    for (const row of rows) {
      expect(row.worst).toBeNull();
      expect(row.cells.every((cell) => cell.severity === "ok")).toBe(true);
    }
  });

  it("treats an empty denominator as no signal rather than a failure", () => {
    const [row] = buildProblemGrid(
      [scenario({ tasks: 0, failedTasks: 0, reworkedTasks: 0, events: [] })],
      5_000,
    );

    expect(row.cells.every((cell) => cell.rate === 0)).toBe(true);
    expect(row.worst).toBeNull();
  });
});
