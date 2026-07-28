import { describe, expect, it } from "vitest";

import { clusterVectors } from "../../src/lib/analytics/clustering";
import { createHashingEmbedder } from "../../src/lib/analytics/embedding";

const embedder = createHashingEmbedder();

/**
 * Groups are built from wordings that overlap, not from topics that merely
 * relate: the embedder is lexical and the test says only what it can do. In the
 * product this is exactly the input it sees — retries and reformulations of the
 * same unresolved request.
 */
const RETRIES = [
  "попробуй ещё раз, предыдущая попытка не завершилась",
  "ещё раз попробуй, попытка не завершилась",
  "попытка не завершилась, попробуй ещё раз пожалуйста",
];
const HOMEWORK = [
  "помоги с домашкой по математике",
  "помоги решить домашку по математике",
  "домашка по математике, помоги решить",
];

describe("clusterVectors", () => {
  it("separates two wordings and names each by its distinctive terms", async () => {
    const texts = [...RETRIES, ...HOMEWORK];
    const vectors = await embedder.embed(texts);
    const clusters = clusterVectors(vectors, texts, { clusterCount: 2 });

    expect(clusters).toHaveLength(2);

    const retryCluster = clusters.find((cluster) =>
      cluster.members.includes(0),
    );
    expect(retryCluster?.members).toEqual([0, 1, 2]);
    expect(retryCluster?.terms).toContain("попытка");
    // A term common to both groups must not be what names one of them.
    expect(clusters[0].terms).not.toEqual(clusters[1].terms);
  });

  it("picks the member closest to the centre as the group's example", async () => {
    const texts = [...RETRIES, ...HOMEWORK];
    const vectors = await embedder.embed(texts);
    const clusters = clusterVectors(vectors, texts, { clusterCount: 2 });

    for (const cluster of clusters) {
      expect(cluster.members).toContain(cluster.representativeIndex);
      expect(cluster.cohesion).toBeGreaterThan(0);
    }
  });

  it("returns the same clusters on every run", async () => {
    const texts = [...RETRIES, ...HOMEWORK];
    const vectors = await embedder.embed(texts);
    const first = clusterVectors(vectors, texts, { clusterCount: 2 });
    const second = clusterVectors(vectors, texts, { clusterCount: 2 });

    expect(first.map((cluster) => cluster.members)).toEqual(
      second.map((cluster) => cluster.members),
    );
  });

  it("never asks for more clusters than there are points", async () => {
    const texts = RETRIES.slice(0, 2);
    const vectors = await embedder.embed(texts);

    expect(
      clusterVectors(vectors, texts, { clusterCount: 9 }).length,
    ).toBeLessThanOrEqual(texts.length);
  });

  it("handles an empty input", () => {
    expect(clusterVectors([], [], { clusterCount: 3 })).toEqual([]);
  });
});
