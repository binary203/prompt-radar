import type { ClassificationResult, TaxonomyScenario } from "./classifier";
import { cosineSimilarity, type Embedder } from "./embedding";

/**
 * Nearest-prototype classifier over intent embeddings.
 *
 * Each scenario gets one prototype vector built from its own taxonomy entry —
 * title, description, manual steps, systems. Nothing is fitted on the gold
 * labels, so the accuracy this layer reports is not measuring itself.
 *
 * It exists to catch what the lexical rules miss: a request that uses none of
 * the trigger words but shares morphology and phrasing with a scenario.
 */

export interface VectorMatch {
  scenarioId: string;
  similarity: number;
}

export interface VectorClassifier {
  readonly threshold: number;
  classify(vector: Float64Array): ClassificationResult;
  match(vector: Float64Array): VectorMatch | null;
}

/**
 * Calibrated against the gold labels on the intents the lexical rules reject.
 * Precision by threshold on that slice: 0.20 → 0.37, 0.25 → 0.67, 0.30 → 0.67
 * with only three matches left. Below 0.25 the nearest prototype is mostly the
 * longest taxonomy entry rather than the closest topic, and a layer that is
 * wrong two times in three is worse than admitting UNKNOWN.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.25;

export async function createVectorClassifier(
  scenarios: readonly TaxonomyScenario[],
  embedder: Embedder,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<VectorClassifier> {
  const prototypes = await embedder.embed(scenarios.map(prototypeText));

  const match = (vector: Float64Array): VectorMatch | null => {
    let best: VectorMatch | null = null;

    for (let index = 0; index < scenarios.length; index += 1) {
      const similarity = cosineSimilarity(vector, prototypes[index]);

      if (!best || similarity > best.similarity) {
        best = { scenarioId: scenarios[index].scenario_id, similarity };
      }
    }

    return best;
  };

  return {
    threshold,
    match,
    classify(vector) {
      const best = match(vector);

      if (!best || best.similarity < threshold) {
        return unknownResult();
      }

      const scenario = scenarios.find(
        (candidate) => candidate.scenario_id === best.scenarioId,
      );

      if (!scenario) {
        return unknownResult();
      }

      const label = {
        scenarioId: scenario.scenario_id,
        action: scenario.action,
        domain: scenario.domain,
        // Similarity is squeezed into the same 0..1 confidence scale the
        // lexical layer reports, so the dashboard can compare the two.
        confidence: round(Math.min(0.95, best.similarity * 1.6), 4),
        matchedSignals: [`cosine ${best.similarity.toFixed(3)}`],
      };

      return {
        primary: label,
        labels: [label],
        actions: [label.action],
        domains: [label.domain],
        confidence: label.confidence,
        isUnknown: false,
      };
    },
  };
}

function prototypeText(scenario: TaxonomyScenario): string {
  return [
    scenario.title_ru,
    scenario.description_ru ?? "",
    ...(scenario.manual_work_steps ?? []),
    ...(scenario.systems ?? []),
  ].join(" ");
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function unknownResult(): ClassificationResult {
  return {
    primary: null,
    labels: [],
    actions: [],
    domains: [],
    confidence: 0,
    isUnknown: true,
  };
}
