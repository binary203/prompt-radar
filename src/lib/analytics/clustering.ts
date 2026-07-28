import { cosineSimilarity, meanVector } from "./embedding";
import { root, tokenize } from "./text";

/**
 * Spherical k-means over intent embeddings.
 *
 * "Spherical" means vectors are L2-normalised and closeness is cosine, so
 * clusters group by direction — what the request is about — rather than by how
 * many words it happens to contain.
 *
 * Seeding is k-means++ driven by a fixed-seed PRNG, so the same log always
 * produces the same clusters. A dashboard that reshuffles its groups on every
 * reload cannot be reasoned about.
 */

export interface Cluster {
  id: number;
  size: number;
  /** Indices into the input array, ascending. */
  members: number[];
  /** Member closest to the centroid: the least arbitrary label for the group. */
  representativeIndex: number;
  /** Mean cosine of members to their centroid. Low means a loose group. */
  cohesion: number;
  terms: string[];
}

export interface ClusteringOptions {
  clusterCount: number;
  maxIterations?: number;
  seed?: number;
}

const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_SEED = 0x5eed;

export function clusterVectors(
  vectors: readonly Float64Array[],
  texts: readonly string[],
  options: ClusteringOptions,
): Cluster[] {
  const dimensions = vectors[0]?.length ?? 0;
  const clusterCount = Math.min(
    Math.max(1, Math.floor(options.clusterCount)),
    vectors.length,
  );

  if (vectors.length === 0 || dimensions === 0) {
    return [];
  }

  const random = mulberry32(options.seed ?? DEFAULT_SEED);
  let centroids = seedCentroids(vectors, clusterCount, random);
  let assignments = new Array<number>(vectors.length).fill(0);

  for (
    let iteration = 0;
    iteration < (options.maxIterations ?? DEFAULT_MAX_ITERATIONS);
    iteration += 1
  ) {
    const next = vectors.map((vector) => nearestCentroid(vector, centroids));

    if (next.every((value, index) => value === assignments[index])) {
      break;
    }

    assignments = next;
    centroids = centroids.map((centroid, clusterId) => {
      const members = vectors.filter(
        (_, index) => assignments[index] === clusterId,
      );
      // An emptied cluster keeps its previous centroid rather than collapsing,
      // which would silently reduce the requested cluster count.
      return members.length > 0 ? meanVector(members, dimensions) : centroid;
    });
  }

  const corpus = documentFrequencies(texts);

  return centroids
    .map((centroid, clusterId) =>
      buildCluster(clusterId, centroid, assignments, vectors, texts, corpus),
    )
    .filter((cluster) => cluster.size > 0)
    .sort((left, right) => right.size - left.size)
    .map((cluster, index) => ({ ...cluster, id: index }));
}

function buildCluster(
  clusterId: number,
  centroid: Float64Array,
  assignments: readonly number[],
  vectors: readonly Float64Array[],
  texts: readonly string[],
  corpus: CorpusFrequencies,
): Cluster {
  const members: number[] = [];

  for (let index = 0; index < assignments.length; index += 1) {
    if (assignments[index] === clusterId) {
      members.push(index);
    }
  }

  let representativeIndex = members[0] ?? -1;
  let bestSimilarity = -Infinity;
  let similaritySum = 0;

  for (const index of members) {
    const similarity = cosineSimilarity(vectors[index], centroid);
    similaritySum += similarity;

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      representativeIndex = index;
    }
  }

  return {
    id: clusterId,
    size: members.length,
    members,
    representativeIndex,
    cohesion: members.length > 0 ? similaritySum / members.length : 0,
    terms: distinctiveTerms(
      members.map((index) => texts[index] ?? ""),
      corpus,
    ),
  };
}

/**
 * k-means++: the first centre is random, each next one is drawn with
 * probability proportional to its squared distance from the centres already
 * chosen. Plain random seeding routinely puts two centres inside one dense
 * topic and leaves a real topic without any.
 */
function seedCentroids(
  vectors: readonly Float64Array[],
  clusterCount: number,
  random: () => number,
): Float64Array[] {
  const centroids: Float64Array[] = [
    vectors[Math.floor(random() * vectors.length)],
  ];

  while (centroids.length < clusterCount) {
    const weights = vectors.map((vector) => {
      const distance = 1 - nearestSimilarity(vector, centroids);
      return distance * distance;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    if (total <= 0) {
      centroids.push(vectors[centroids.length % vectors.length]);
      continue;
    }

    let threshold = random() * total;
    let picked = vectors.length - 1;

    for (let index = 0; index < weights.length; index += 1) {
      threshold -= weights[index];
      if (threshold <= 0) {
        picked = index;
        break;
      }
    }

    centroids.push(vectors[picked]);
  }

  return centroids;
}

function nearestCentroid(
  vector: Float64Array,
  centroids: readonly Float64Array[],
): number {
  let best = 0;
  let bestSimilarity = -Infinity;

  for (let index = 0; index < centroids.length; index += 1) {
    const similarity = cosineSimilarity(vector, centroids[index]);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      best = index;
    }
  }

  return best;
}

function nearestSimilarity(
  vector: Float64Array,
  centroids: readonly Float64Array[],
): number {
  let best = -Infinity;

  for (const centroid of centroids) {
    best = Math.max(best, cosineSimilarity(vector, centroid));
  }

  return best;
}

interface CorpusFrequencies {
  documentCount: number;
  frequency: ReadonlyMap<string, number>;
}

function documentFrequencies(texts: readonly string[]): CorpusFrequencies {
  const frequency = new Map<string, number>();

  for (const text of texts) {
    for (const token of new Set(tokenize(text).map(root))) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  return { documentCount: texts.length, frequency };
}

/**
 * Terms that name the group, scored by how much more common they are inside it
 * than in the corpus. Plain frequency would label every cluster with the same
 * conversational filler, which names nothing.
 */
function distinctiveTerms(
  texts: readonly string[],
  corpus: CorpusFrequencies,
  limit = 4,
): string[] {
  const inCluster = new Map<string, number>();

  for (const text of texts) {
    for (const token of new Set(tokenize(text).map(root))) {
      inCluster.set(token, (inCluster.get(token) ?? 0) + 1);
    }
  }

  const scored = [...inCluster.entries()].map(([term, count]) => {
    const corpusCount = corpus.frequency.get(term) ?? count;
    const inverseDocumentFrequency = Math.log(
      (corpus.documentCount + 1) / (corpusCount + 1),
    );

    return { term, score: (count / texts.length) * inverseDocumentFrequency };
  });

  return scored
    .sort(
      (left, right) =>
        right.score - left.score || left.term.localeCompare(right.term),
    )
    .slice(0, limit)
    .map((entry) => entry.term);
}

/** Small, fast, fully deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
