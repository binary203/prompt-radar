import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  goldLabelSchema,
  operationalEventSchema,
} from "../../src/lib/contracts/operational";

const DATA_DIR = join(process.cwd(), "src", "data", "synthetic");

function readJsonLines(name: string) {
  return readFileSync(join(DATA_DIR, name), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

describe("synthetic operational dataset", () => {
  const rawOperationalLog = readFileSync(
    join(DATA_DIR, "operational-log.jsonl"),
    "utf8",
  );
  const events = readJsonLines("operational-log.jsonl").map((event) =>
    operationalEventSchema.parse(event),
  );
  const goldLabels = goldLabelSchema.array().parse(
    JSON.parse(readFileSync(join(DATA_DIR, "gold-labels.json"), "utf8")),
  );

  it("keeps exactly 1,500 operational events and matching separate labels", () => {
    expect(events).toHaveLength(1_500);
    expect(goldLabels).toHaveLength(1_500);
    expect(new Set(events.map(({ id }) => id)).size).toBe(1_500);
    expect(goldLabels.map(({ id }) => id)).toEqual(
      events.map(({ id }) => id),
    );
  });

  it("does not leak benchmark labels into the operational input", () => {
    for (const forbiddenKey of [
      "scenarioIds",
      "primaryAction",
      "primaryDomain",
      "variantType",
      "manualMinutes",
    ]) {
      expect(rawOperationalLog).not.toContain(`"${forbiddenKey}"`);
    }
  });

  it("models the platform as costlier but used by fewer people", () => {
    const web = events.filter(({ agentName }) => agentName === "web_chat");
    const platform = events.filter(
      ({ agentName }) => agentName === "agent_platform",
    );
    const averageTokens = (
      records: typeof events,
    ) =>
      records.reduce(
        (sum, { usage }) => sum + usage.totalTokens,
        0,
      ) / records.length;
    const averageTools = (
      records: typeof events,
    ) =>
      records.reduce(
        (sum, { toolCalls }) => sum + toolCalls.length,
        0,
      ) / records.length;

    expect(new Set(platform.map(({ userId }) => userId)).size).toBeLessThan(
      new Set(web.map(({ userId }) => userId)).size,
    );
    expect(averageTokens(platform)).toBeGreaterThan(averageTokens(web));
    expect(averageTools(platform)).toBeGreaterThan(averageTools(web));
  });

  it("contains 20% compact RAG-wrapped requests", () => {
    const ragRecords = events.filter(({ request }) =>
      request.messages.some(({ content }) =>
        content.includes("<user_query>"),
      ),
    );

    expect(ragRecords).toHaveLength(300);
  });
});
