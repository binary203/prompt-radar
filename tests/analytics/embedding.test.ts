import { describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  createHashingEmbedder,
} from "../../src/lib/analytics/embedding";

const embedder = createHashingEmbedder();

describe("hashing embedder", () => {
  it("is deterministic and unit length", async () => {
    const [first] = await embedder.embed(["сводка по входящей почте за день"]);
    const [second] = await embedder.embed(["сводка по входящей почте за день"]);

    expect([...first]).toEqual([...second]);
    expect(cosineSimilarity(first, first)).toBeCloseTo(1, 10);
  });

  it("keeps morphological variants closer than unrelated requests", async () => {
    const [base, inflected, unrelated] = await embedder.embed([
      "найди клиента по сделке в CRM",
      "найти клиентов по сделкам в CRM",
      "запланируй встречу с подрядчиком на четверг",
    ]);

    expect(cosineSimilarity(base, inflected)).toBeGreaterThan(
      cosineSimilarity(base, unrelated),
    );
  });

  it("returns a zero vector for text with no features", async () => {
    const [empty] = await embedder.embed([""]);

    expect(empty.every((value) => value === 0)).toBe(true);
  });
});
