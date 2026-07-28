import { normalizeText, root, tokenize } from "./text";

/**
 * A vector representation of an intent, built locally with no model download,
 * no external call and no new dependency.
 *
 * The feature hashing trick maps an unbounded vocabulary into a fixed number of
 * dimensions: every feature is hashed to a slot, and the hash's sign bit
 * decides whether it adds or subtracts. Collisions therefore cancel out on
 * average instead of always inflating a slot, which is what makes the trick
 * usable at this dimensionality.
 *
 * Features are rooted word unigrams, adjacent word bigrams and character
 * trigrams. Trigrams are what make it survive Russian morphology and typos:
 * "интеграци" and "интеграция" share almost every trigram.
 *
 * This is a lexical embedding, not a neural one. It captures overlap of form,
 * not meaning — two paraphrases with no shared morphemes stay far apart. That
 * is exactly why the pipeline keeps an LLM layer behind it.
 */

export const EMBEDDING_DIMENSIONS = 256;

export interface Embedder {
  /** Shown in the pipeline telemetry so the reader knows what produced them. */
  readonly name: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<Float64Array[]>;
}

const CHAR_NGRAM = 3;

export function createHashingEmbedder(
  dimensions: number = EMBEDDING_DIMENSIONS,
): Embedder {
  return {
    name: `hashing-${dimensions}`,
    dimensions,
    async embed(texts) {
      return texts.map((text) => embedOne(text, dimensions));
    },
  };
}

function embedOne(text: string, dimensions: number): Float64Array {
  const vector = new Float64Array(dimensions);
  const counts = new Map<string, number>();

  for (const feature of features(text)) {
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }

  for (const [feature, count] of counts) {
    const hash = hash32(feature);
    const slot = hash % dimensions;
    // Sublinear term frequency: the tenth repeat of a word says much less than
    // the second, and long requests should not dominate short ones.
    const weight = 1 + Math.log(count);
    vector[slot] += (hash & 0x8000_0000) === 0 ? weight : -weight;
  }

  return l2Normalize(vector);
}

function* features(text: string): Generator<string> {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized).map(root);

  for (const token of tokens) {
    yield `w:${token}`;
  }

  for (let index = 1; index < tokens.length; index += 1) {
    yield `b:${tokens[index - 1]}_${tokens[index]}`;
  }

  const padded = ` ${normalized.replace(/\s+/gu, " ")} `;
  for (let index = 0; index + CHAR_NGRAM <= padded.length; index += 1) {
    yield `c:${padded.slice(index, index + CHAR_NGRAM)}`;
  }
}

/** FNV-1a, 32-bit. Stable across runs and platforms, unlike a seeded PRNG. */
function hash32(value: string): number {
  let hash = 0x811c_9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }

  return hash >>> 0;
}

export function l2Normalize(vector: Float64Array): Float64Array {
  let sumOfSquares = 0;

  for (const value of vector) {
    sumOfSquares += value * value;
  }

  if (sumOfSquares === 0) {
    return vector;
  }

  const inverseNorm = 1 / Math.sqrt(sumOfSquares);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] *= inverseNorm;
  }

  return vector;
}

/** Dot product. Inputs are expected to be L2-normalised already. */
export function cosineSimilarity(
  left: Float64Array,
  right: Float64Array,
): number {
  const length = Math.min(left.length, right.length);
  let total = 0;

  for (let index = 0; index < length; index += 1) {
    total += left[index] * right[index];
  }

  return total;
}

export function meanVector(
  vectors: readonly Float64Array[],
  dimensions: number,
): Float64Array {
  const centroid = new Float64Array(dimensions);

  if (vectors.length === 0) {
    return centroid;
  }

  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      centroid[index] += vector[index];
    }
  }

  for (let index = 0; index < dimensions; index += 1) {
    centroid[index] /= vectors.length;
  }

  return l2Normalize(centroid);
}
