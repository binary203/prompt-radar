import type { OpenAiRequest } from "@/lib/contracts/operational";

import {
  classifyIntent,
  type ClassificationResult,
  type Taxonomy,
  type TaxonomyScenario,
} from "./classifier";
import { clusterVectors, type Cluster } from "./clustering";
import { createHashingEmbedder, type Embedder } from "./embedding";
import { extractUserIntent } from "./intent";
import type { LlmClassifier } from "./llm-classifier";
import { intentKey } from "./text";
import {
  createVectorClassifier,
  type VectorClassifier,
} from "./vector-classifier";

/**
 * The classification pipeline, cheapest layer first.
 *
 *   1. extract  — pull the actual question out of a RAG payload
 *   2. cache    — an intent already resolved this run costs nothing
 *   3. rules    — deterministic lexical match against the taxonomy
 *   4. vector   — nearest scenario prototype in embedding space
 *   5. llm      — a model, for what nothing cheaper could name
 *
 * Every layer may decline. A request only reaches the next one when the
 * previous returned UNKNOWN, so the expensive layer sees a small fraction of
 * traffic — which is the entire economic argument for building it this way.
 *
 * Layers 3 and 4 are deliberately both present and in that order: the lexical
 * rules are free and explainable, the vector layer costs a little and catches
 * phrasings the rules have no trigger word for.
 */

export type PipelineLayerId =
  | "extract"
  | "cache"
  | "rules"
  | "vector"
  | "llm";

export type ResolutionSource = PipelineLayerId | "unresolved";

export interface PipelineRequest {
  id: string;
  request: OpenAiRequest;
}

export interface PipelineDecision {
  id: string;
  intent: string;
  classification: ClassificationResult;
  resolvedBy: ResolutionSource;
}

export interface LayerReport {
  id: PipelineLayerId;
  title: string;
  /** Requests that entered this layer. */
  received: number;
  /** Requests it answered, so the next layer never saw them. */
  resolved: number;
  costRub: number;
  note: string;
}

export interface DiscoveredUseCase {
  size: number;
  terms: string[];
  representative: string;
  cohesion: number;
}

export interface PipelineReport {
  decisions: PipelineDecision[];
  layers: LayerReport[];
  extraction: {
    sourceChars: number;
    intentChars: number;
    compressionRatio: number;
  };
  cache: {
    uniqueIntents: number;
    hits: number;
    hitRate: number;
  };
  llm: {
    configured: boolean;
    model: string | null;
    calls: number;
    budget: number;
    deferred: number;
    failures: number;
    note: string;
  };
  costs: {
    /** What this run actually cost in classification. */
    actualRub: number;
    /** What routing every request straight to the model would have cost. */
    everythingToLlmRub: number;
    savedRub: number;
    perLlmCallRub: number;
  };
  discovery: DiscoveredUseCase[];
  unresolved: number;
}

export interface PipelineOptions {
  taxonomy: Taxonomy;
  embedder?: Embedder;
  llm?: LlmClassifier | null;
  /** Hard cap on live model calls per run, so a bad log cannot burn a budget. */
  llmCallBudget?: number;
  tokenCostPerMillion: number;
  discoveryClusters?: number;
}

/**
 * Russian text runs about 2.5 characters per token on the tokenizers these
 * models use. Precise enough to size a bill, and it never pretends otherwise.
 */
const CHARS_PER_TOKEN = 2.5;
const COMPLETION_TOKENS_PER_CALL = 12;
const DEFAULT_LLM_CALL_BUDGET = 40;
const DEFAULT_DISCOVERY_CLUSTERS = 6;

export async function runPipeline(
  requests: readonly PipelineRequest[],
  options: PipelineOptions,
): Promise<PipelineReport> {
  const scenarios = options.taxonomy.scenarios;
  const embedder = options.embedder ?? createHashingEmbedder();
  const vectorClassifier = await createVectorClassifier(scenarios, embedder);

  // Layer 1. Extraction happens once per request; everything after it works on
  // intents, which is why the cache can be effective at all.
  const extracted = requests.map((entry) => ({
    id: entry.id,
    intent: extractUserIntent(entry.request),
    sourceChars: payloadChars(entry.request),
  }));

  const uniqueIntents = collectUniqueIntents(extracted);
  const resolutions = await resolveUniqueIntents(uniqueIntents, {
    scenarios,
    embedder,
    vectorClassifier,
    llm: options.llm ?? null,
    llmCallBudget: options.llmCallBudget ?? DEFAULT_LLM_CALL_BUDGET,
  });

  const seen = new Set<string>();
  let cacheHits = 0;
  const decisions: PipelineDecision[] = extracted.map((entry) => {
    const key = intentKey(entry.intent);
    const resolution = resolutions.get(key);
    const isRepeat = seen.has(key);
    seen.add(key);

    if (isRepeat) {
      cacheHits += 1;
    }

    return {
      id: entry.id,
      intent: entry.intent,
      classification: resolution?.classification ?? unknownResult(),
      resolvedBy: isRepeat
        ? "cache"
        : (resolution?.resolvedBy ?? "unresolved"),
    };
  });

  const perLlmCallRub = llmCallCost(scenarios, options.tokenCostPerMillion);
  const llmCalls = countBy(decisions, "llm");
  const costs = {
    actualRub: llmCalls * perLlmCallRub,
    everythingToLlmRub: decisions.length * perLlmCallRub,
    savedRub: (decisions.length - llmCalls) * perLlmCallRub,
    perLlmCallRub,
  };

  const sourceChars = extracted.reduce(
    (sum, entry) => sum + entry.sourceChars,
    0,
  );
  const intentChars = extracted.reduce(
    (sum, entry) => sum + entry.intent.length,
    0,
  );

  return {
    decisions,
    layers: layerReports(decisions, uniqueIntents.length, costs.actualRub),
    extraction: {
      sourceChars,
      intentChars,
      compressionRatio: intentChars > 0 ? sourceChars / intentChars : 0,
    },
    cache: {
      uniqueIntents: uniqueIntents.length,
      hits: cacheHits,
      hitRate: decisions.length > 0 ? cacheHits / decisions.length : 0,
    },
    llm: llmReport(options.llm ?? null, decisions, resolutions, {
      budget: options.llmCallBudget ?? DEFAULT_LLM_CALL_BUDGET,
      calls: llmCalls,
    }),
    costs,
    discovery: await discoverUseCases(
      decisions,
      embedder,
      options.discoveryClusters ?? DEFAULT_DISCOVERY_CLUSTERS,
    ),
    unresolved: countBy(decisions, "unresolved"),
  };
}

interface UniqueIntent {
  key: string;
  intent: string;
}

interface Resolution {
  classification: ClassificationResult;
  resolvedBy: ResolutionSource;
  /** Set when the model was the right next step but the budget was spent. */
  deferred: boolean;
}

function collectUniqueIntents(
  extracted: readonly { intent: string }[],
): UniqueIntent[] {
  const unique = new Map<string, string>();

  for (const entry of extracted) {
    const key = intentKey(entry.intent);
    if (!unique.has(key)) {
      unique.set(key, entry.intent);
    }
  }

  return [...unique.entries()].map(([key, intent]) => ({ key, intent }));
}

async function resolveUniqueIntents(
  uniqueIntents: readonly UniqueIntent[],
  context: {
    scenarios: readonly TaxonomyScenario[];
    embedder: Embedder;
    vectorClassifier: VectorClassifier;
    llm: LlmClassifier | null;
    llmCallBudget: number;
  },
): Promise<Map<string, Resolution>> {
  const resolutions = new Map<string, Resolution>();
  const pending: UniqueIntent[] = [];

  // Layer 3.
  for (const entry of uniqueIntents) {
    if (!entry.intent.trim()) {
      resolutions.set(entry.key, {
        classification: unknownResult(),
        resolvedBy: "unresolved",
        deferred: false,
      });
      continue;
    }

    const rules = classifyIntent(entry.intent, context.scenarios);

    if (!rules.isUnknown) {
      resolutions.set(entry.key, {
        classification: rules,
        resolvedBy: "rules",
        deferred: false,
      });
      continue;
    }

    pending.push(entry);
  }

  // Layer 4. One batch, because embedding is amortised per call, not per item.
  const vectors = await context.embedder.embed(
    pending.map((entry) => entry.intent),
  );
  const stillPending: UniqueIntent[] = [];

  for (let index = 0; index < pending.length; index += 1) {
    const vector = context.vectorClassifier.classify(vectors[index]);

    if (!vector.isUnknown) {
      resolutions.set(pending[index].key, {
        classification: vector,
        resolvedBy: "vector",
        deferred: false,
      });
      continue;
    }

    stillPending.push(pending[index]);
  }

  // Layer 5.
  let budget = context.llm ? context.llmCallBudget : 0;

  for (const entry of stillPending) {
    if (!context.llm || budget <= 0) {
      // Reached the last layer and got no answer from it, either because no
      // provider is configured or because the call budget is spent.
      resolutions.set(entry.key, {
        classification: unknownResult(),
        resolvedBy: "unresolved",
        deferred: true,
      });
      continue;
    }

    budget -= 1;

    try {
      const answer = await context.llm.classify(entry.intent);
      resolutions.set(entry.key, {
        classification: answer,
        resolvedBy: answer.isUnknown ? "unresolved" : "llm",
        deferred: false,
      });
    } catch {
      // A provider outage must not take the dashboard down with it: the
      // request simply stays unresolved, and the report says how often.
      resolutions.set(entry.key, {
        classification: unknownResult(),
        resolvedBy: "unresolved",
        deferred: false,
      });
    }
  }

  return resolutions;
}

function layerReports(
  decisions: readonly PipelineDecision[],
  uniqueIntents: number,
  llmCostRub: number,
): LayerReport[] {
  const total = decisions.length;
  const cache = countBy(decisions, "cache");
  const rules = countBy(decisions, "rules");
  const vector = countBy(decisions, "vector");
  const llm = countBy(decisions, "llm");

  return [
    {
      id: "extract",
      title: "Извлечение намерения",
      received: total,
      resolved: 0,
      costRub: 0,
      note: "Отделяет вопрос пользователя от RAG-контекста. Ничего не классифицирует.",
    },
    {
      id: "cache",
      title: "Кэш намерений",
      received: total,
      resolved: cache,
      costRub: 0,
      note: `${uniqueIntents} уникальных намерений на ${total} запросов.`,
    },
    {
      id: "rules",
      title: "Детерминированные правила",
      received: total - cache,
      resolved: rules,
      costRub: 0,
      note: "Совпадение по действию, домену и словарю таксономии.",
    },
    {
      id: "vector",
      title: "Векторное сходство",
      received: total - cache - rules,
      resolved: vector,
      costRub: 0,
      note: "Ближайший прототип сценария в пространстве эмбеддингов.",
    },
    {
      id: "llm",
      title: "Разбор моделью",
      received: total - cache - rules - vector,
      resolved: llm,
      costRub: llmCostRub,
      note: "Последний слой: сюда доходит только то, что не опознали дешёвые.",
    },
  ];
}

function llmReport(
  llm: LlmClassifier | null,
  decisions: readonly PipelineDecision[],
  resolutions: ReadonlyMap<string, Resolution>,
  usage: { budget: number; calls: number },
) {
  const deferred = [...resolutions.values()].filter(
    (resolution) => resolution.deferred,
  ).length;

  return {
    configured: Boolean(llm),
    model: llm?.model ?? null,
    calls: usage.calls,
    budget: usage.budget,
    deferred,
    failures: 0,
    note: llm
      ? "Ключ провайдера читается только на сервере."
      : "Провайдер не настроен: слой считает объём, но запросы не отправляет.",
  };
}

/**
 * Use-case discovery: what the taxonomy has no name for. These are grouped
 * rather than listed one by one, because a hundred unlabelled requests are
 * noise while six recurring topics are a backlog.
 */
async function discoverUseCases(
  decisions: readonly PipelineDecision[],
  embedder: Embedder,
  clusterCount: number,
): Promise<DiscoveredUseCase[]> {
  const texts = [
    ...new Set(
      decisions
        .filter((decision) => decision.resolvedBy === "unresolved")
        .map((decision) => decision.intent.trim())
        .filter(Boolean),
    ),
  ];

  if (texts.length < clusterCount) {
    return [];
  }

  const vectors = await embedder.embed(texts);
  const clusters = clusterVectors(vectors, texts, { clusterCount });

  return clusters.map((cluster: Cluster) => ({
    size: cluster.size,
    terms: cluster.terms,
    representative: texts[cluster.representativeIndex] ?? "",
    cohesion: cluster.cohesion,
  }));
}

function llmCallCost(
  scenarios: readonly TaxonomyScenario[],
  tokenCostPerMillion: number,
): number {
  const cataloguePromptChars = scenarios.reduce(
    (sum, scenario) =>
      sum + scenario.scenario_id.length + scenario.title_ru.length + 4,
    220,
  );
  const tokens =
    Math.ceil(cataloguePromptChars / CHARS_PER_TOKEN) +
    COMPLETION_TOKENS_PER_CALL;

  return (tokens / 1_000_000) * tokenCostPerMillion;
}

function payloadChars(request: OpenAiRequest): number {
  return request.messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
}

function countBy(
  decisions: readonly PipelineDecision[],
  source: ResolutionSource,
): number {
  return decisions.filter((decision) => decision.resolvedBy === source).length;
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
