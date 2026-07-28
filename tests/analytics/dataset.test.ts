import { describe, expect, it } from "vitest";

import { parseOperationalLog } from "../../src/lib/analytics/dataset";

const EVENT = {
  id: "evt_1",
  createdAt: "2026-06-01T09:00:00.000Z",
  userId: "u1",
  userRole: "менеджер по продажам",
  department: "Продажи",
  agentName: "web_chat",
  request: {
    model: "corporate-assistant",
    messages: [{ role: "user", content: "сводка по почте за день" }],
  },
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  latencyMs: 1_200,
  toolCalls: [],
  outcome: "success",
  feedback: 0,
};

function line(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ ...EVENT, ...overrides });
}

describe("parseOperationalLog", () => {
  it("reads JSONL", () => {
    const parsed = parseOperationalLog(
      [line(), line({ id: "evt_2" })].join("\n"),
    );

    expect(parsed.events).toHaveLength(2);
    expect(parsed.problems).toEqual([]);
    expect(parsed.totalLines).toBe(2);
  });

  it("reads a plain JSON array just as well", () => {
    const parsed = parseOperationalLog(
      JSON.stringify([EVENT, { ...EVENT, id: "evt_2" }]),
    );

    expect(parsed.events).toHaveLength(2);
  });

  it("keeps the good records when some lines are broken", () => {
    const parsed = parseOperationalLog(
      [line(), "{ не json", line({ id: "evt_3" })].join("\n"),
    );

    expect(parsed.events.map((event) => event.id)).toEqual([
      "evt_1",
      "evt_3",
    ]);
    expect(parsed.problems[0]).toContain("Строка 2");
  });

  it("says which field is wrong rather than just failing", () => {
    const parsed = parseOperationalLog(
      JSON.stringify({ ...EVENT, usage: { inputTokens: "много" } }),
    );

    expect(parsed.events).toHaveLength(0);
    expect(parsed.problems[0]).toContain("usage");
  });

  it("does not list four hundred broken lines one by one", () => {
    const parsed = parseOperationalLog(
      Array.from({ length: 400 }, () => "{ broken").join("\n"),
    );

    expect(parsed.problems.length).toBeLessThanOrEqual(6);
    expect(parsed.problems.at(-1)).toContain("ещё");
  });

  it("reports an empty file as empty", () => {
    expect(parseOperationalLog("   ").problems).toEqual(["Файл пустой."]);
  });
});
