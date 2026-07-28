import type { ClassificationResult } from "./classifier";
import type { LlmClassifier } from "./llm-classifier";

/**
 * The model layer as seen from the browser.
 *
 * It has the same shape as the server-side classifier, so the pipeline neither
 * knows nor cares which one it got. The difference is where the key lives: this
 * one sends the intent to our own route and never sees a provider credential.
 *
 * If the route reports no provider, this returns null and the pipeline runs
 * with four layers — the funnel then says how much traffic would have needed a
 * fifth, which is the honest thing to show.
 */
export async function createRemoteLlmClassifier(
  endpoint = "/api/classify",
): Promise<LlmClassifier | null> {
  const probe = await postIntents(endpoint, []);

  if (!probe) {
    return null;
  }

  return {
    model: probe.model,
    async classify(intent) {
      const response = await postIntents(endpoint, [intent]);
      const classification = response?.results[0]?.classification;

      if (!classification) {
        throw new Error("Слой модели не ответил");
      }

      return classification;
    },
  };
}

interface ClassifyResponse {
  model: string;
  results: Array<{
    intent: string;
    classification: ClassificationResult | null;
  }>;
}

async function postIntents(
  endpoint: string,
  intents: readonly string[],
): Promise<ClassifyResponse | null> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intents }),
    });

    return response.ok ? ((await response.json()) as ClassifyResponse) : null;
  } catch {
    return null;
  }
}
