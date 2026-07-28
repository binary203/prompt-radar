/**
 * Text normalisation shared by every layer that looks at Russian intent text.
 * Keeping it in one place means the cache key, the lexical classifier and the
 * embedder all agree on what counts as the same word.
 */

export const STOP_WORDS = new Set([
  "без",
  "был",
  "быть",
  "вам",
  "ваш",
  "весь",
  "для",
  "его",
  "еще",
  "или",
  "как",
  "какая",
  "какой",
  "которые",
  "мне",
  "мои",
  "мой",
  "надо",
  "наш",
  "она",
  "они",
  "при",
  "про",
  "свой",
  "так",
  "там",
  "что",
  "это",
  "the",
  "and",
  "for",
  "from",
  "with",
]);

/** Lowercase, collapse ё to е, trim. Nothing lossy beyond that. */
export function normalizeText(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

/**
 * Poor man's stemmer: Russian inflection lives in the tail, so a fixed-length
 * prefix collapses "клиента" and "клиентами" without a morphology dictionary.
 */
export function root(token: string): string {
  return token.length > 7 ? token.slice(0, 7) : token;
}

/**
 * Cache key for an intent. Word order is preserved deliberately — "клиент по
 * сделке" and "сделка по клиенту" are different questions.
 */
export function intentKey(value: string): string {
  return tokenize(value).map(root).join(" ");
}
