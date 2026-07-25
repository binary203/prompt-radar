import { readFile } from "node:fs/promises";
import path from "node:path";

import taxonomyData from "@/data/synthetic/taxonomy.json";
import {
  aggregateEvents,
  calculateRoi,
  classifyIntent,
  extractUserIntent,
  type ClassificationResult,
  type Taxonomy,
} from "@/lib/analytics";
import {
  operationalEventSchema,
  type OperationalEvent,
} from "@/lib/contracts/operational";

export const runtime = "nodejs";

type GoldLabel = {
  id: string;
  scenarioIds: string[];
  primaryAction: string;
  primaryDomain: string;
};

type Prediction = {
  event: OperationalEvent;
  intent: string;
  classification: ClassificationResult;
};

const DEMO_COSTS = {
  tokenCostPerThousand: 4.3,
  fixedCostsFor60DaySample: {
    team: 150_000,
    infrastructure: 75_000,
    licenses: 150_000,
    amortization: 120_000,
  },
} as const;

const DEMO_WRAPPED_MESSAGE =
  "<context>Большой фрагмент корпоративной документации и истории переписки, который не должен определять категорию запроса.</context>\n<user_query>а с госсистемой Честный знак какая интеграция и для чего?</user_query>";

let cachedCheckpoint: Promise<Record<string, unknown>> | null = null;

export async function GET() {
  cachedCheckpoint ??= buildCheckpoint();

  try {
    return Response.json(await cachedCheckpoint);
  } catch (error) {
    cachedCheckpoint = null;
    throw error;
  }
}

async function buildCheckpoint(): Promise<Record<string, unknown>> {
  const [events, goldLabels] = await Promise.all([
    loadOperationalEvents(),
    loadGoldLabels(),
  ]);
  const taxonomy = taxonomyData as Taxonomy;
  const predictions = events.map((event) => predict(event, taxonomy));
  const period = getEventPeriod(events);
  const aggregation = aggregateEvents(
    predictions.map(({ event, classification }) => ({
      ...event,
      scenarioIds: classification.labels.map((label) => label.scenarioId),
    })),
  );
  const uniqueTaskCount = Math.max(
    0,
    aggregation.requests - aggregation.repeats,
  );
  const roi = calculateRoi({
    requestCount: uniqueTaskCount,
    manualMinutesPerRequest: { low: 30, base: 45, high: 65 },
    outcome: {
      successRate: {
        low: Math.max(0, aggregation.successRate * 0.85),
        base: aggregation.successRate,
        high: Math.min(1, aggregation.successRate * 1.1),
      },
      repeatRate: {
        low: Math.min(1, aggregation.repeatRate * 1.25),
        base: aggregation.repeatRate,
        high: aggregation.repeatRate * 0.75,
      },
      reviewTax: { low: 0.5, base: 0.3, high: 0.15 },
      feedbackFactor: { low: 0.85, base: 0.95, high: 0.99 },
    },
    totalTokens: aggregation.totalTokens,
    tokenCostPerThousand: DEMO_COSTS.tokenCostPerThousand,
    fixedCosts: DEMO_COSTS.fixedCostsFor60DaySample,
  });

  const scenarioTitleById = Object.fromEntries(
    taxonomy.scenarios.map((scenario) => [
      scenario.scenario_id,
      scenario.title_ru,
    ]),
  );
  const topScenarios = Object.entries(aggregation.perScenario)
    .filter(([scenarioId]) => scenarioId !== "unknown")
    .sort(([, left], [, right]) => right.requests - left.requests)
    .slice(0, 6)
    .map(([scenarioId, metrics]) => ({
      id: scenarioId,
      title: scenarioTitleById[scenarioId] ?? scenarioId,
      requests: metrics.requests,
      successRate: metrics.successRate,
      repeatRate: metrics.repeatRate,
      tokens: metrics.totalTokens,
    }));

  const checkpoint = {
    generatedAt: new Date().toISOString(),
    mode: "synthetic-checkpoint",
    evidenceLevel: "request + tool trace + synthetic outcome",
    dataset: {
      events: aggregation.requests,
      uniqueIntentSeeds: 188,
      periodDays: 60,
      activeUsers: aggregation.activeUsers,
      mau: aggregation.mau,
      period,
    },
    usage: {
      toolCalls: aggregation.toolCalls,
      toolErrors: countToolErrors(events),
      toolErrorRate: safeRate(
        countToolErrors(events),
        aggregation.toolCalls,
      ),
      tokens: aggregation.totalTokens,
      successes: aggregation.successes,
      partials: aggregation.partials,
      errors: aggregation.errors,
      repeats: aggregation.repeats,
      successRate: aggregation.successRate,
      repeatRate: aggregation.repeatRate,
      averageLatencyMs: average(events.map((event) => event.latencyMs)),
      p95LatencyMs: percentile(
        events.map((event) => event.latencyMs),
        0.95,
      ),
    },
    economics: {
      assumptions: {
        monthlyFteCostRub: roi.assumptions.fteMonthlyCost,
        workingHoursPerMonth: roi.assumptions.workingHoursPerMonth,
        proxyManualMinutesPerTask: { low: 30, base: 45, high: 65 },
        uniqueTaskCount,
        costsFor60DayDemoSampleRub:
          DEMO_COSTS.fixedCostsFor60DaySample,
        tokenCostPerThousandRub: DEMO_COSTS.tokenCostPerThousand,
      },
      potentialValueRub: {
        low: roi.low.potentialValue,
        base: roi.base.potentialValue,
        high: roi.high.potentialValue,
      },
      realizedValueRub: {
        low: roi.low.realizedValue,
        base: roi.base.realizedValue,
        high: roi.high.realizedValue,
      },
      valueGapRub: {
        low: roi.low.valueGap,
        base: roi.base.valueGap,
        high: roi.high.valueGap,
      },
      tcoRub: roi.tco,
      roi: { low: roi.low.roi, base: roi.base.roi, high: roi.high.roi },
      returnPerRuble: {
        low: roi.low.returnPerRuble,
        base: roi.base.returnPerRuble,
        high: roi.high.returnPerRuble,
      },
      fteMonthsRealized: {
        low: roi.low.fteMonthsRealized,
        base: roi.base.fteMonthsRealized,
        high: roi.high.fteMonthsRealized,
      },
    },
    evaluation: evaluate(predictions, goldLabels),
    agents: aggregation.perAgent,
    trend: buildWeeklyTrend(events),
    topScenarios,
    intentExtractionDemo: {
      sourceChars: DEMO_WRAPPED_MESSAGE.length,
      extracted: extractUserIntent({
        messages: [
          {
            role: "user",
            content: DEMO_WRAPPED_MESSAGE,
          },
        ],
      }),
      expectedRouting: "UNKNOWN: передать в LLM fallback",
    },
    disclaimer:
      "Финансовые значения — proxy для воспроизводимости формул на синтетике: повторы исключены из нового спроса, ручное время задано диапазоном, TCO аллоцирован на 60-дневную выборку. Боевой ROI требует калибровки КРОК.",
  };

  return checkpoint;
}

function predict(event: OperationalEvent, taxonomy: Taxonomy): Prediction {
  const intent = extractUserIntent(event.request);
  return {
    event,
    intent,
    classification: classifyIntent(intent, taxonomy),
  };
}

function evaluate(predictions: Prediction[], goldLabels: GoldLabel[]) {
  const goldById = new Map(goldLabels.map((label) => [label.id, label]));
  const seenIntents = new Set<string>();
  let scenarioHits = 0;
  let actionHits = 0;
  let domainHits = 0;
  let evaluated = 0;
  let predictedUnknown = 0;

  for (const prediction of predictions) {
    const gold = goldById.get(prediction.event.id);
    const intentKey = prediction.intent.toLocaleLowerCase("ru-RU").trim();
    if (!gold || seenIntents.has(intentKey)) {
      continue;
    }

    seenIntents.add(intentKey);
    evaluated += 1;
    const primary = prediction.classification.primary;
    const scenarioHit =
      gold.scenarioIds.length === 0
        ? prediction.classification.isUnknown
        : primary !== null &&
          gold.scenarioIds.includes(primary.scenarioId);

    scenarioHits += Number(scenarioHit);
    actionHits += Number(primary?.action === gold.primaryAction);
    domainHits += Number(primary?.domain === gold.primaryDomain);
    predictedUnknown += Number(prediction.classification.isUnknown);
  }

  return {
    evaluated,
    scenarioTop1Accuracy: safeRate(scenarioHits, evaluated),
    actionAccuracy: safeRate(actionHits, evaluated),
    domainAccuracy: safeRate(domainHits, evaluated),
    predictedUnknownRate: safeRate(predictedUnknown, evaluated),
    note:
      "Метрики считаются по уникальным intent; gold-разметка применяется только после предсказаний.",
  };
}

async function loadOperationalEvents(): Promise<OperationalEvent[]> {
  const raw = await readFile(
    path.join(
      process.cwd(),
      "src/data/synthetic/operational-log.jsonl",
    ),
    "utf8",
  );

  return raw
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => operationalEventSchema.parse(JSON.parse(line)));
}

async function loadGoldLabels(): Promise<GoldLabel[]> {
  const raw = await readFile(
    path.join(process.cwd(), "src/data/synthetic/gold-labels.json"),
    "utf8",
  );

  return JSON.parse(raw) as GoldLabel[];
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function getEventPeriod(events: OperationalEvent[]) {
  const timestamps = events
    .map((event) => new Date(event.createdAt).valueOf())
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  if (timestamps.length === 0) {
    return { from: null, to: null };
  }

  return {
    from: new Date(timestamps[0]).toISOString(),
    to: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
}

function countToolErrors(events: OperationalEvent[]) {
  return events.reduce(
    (total, event) =>
      total +
      event.toolCalls.filter((toolCall) => toolCall.status === "error")
        .length,
    0,
  );
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], rate: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.floor((sorted.length - 1) * rate);
  return sorted[index];
}

function buildWeeklyTrend(events: OperationalEvent[]) {
  const DAY_MS = 86_400_000;
  const BUCKET_MS = DAY_MS * 7;
  const timestamps = events
    .map((event) => new Date(event.createdAt).valueOf())
    .filter(Number.isFinite);

  if (timestamps.length === 0) {
    return [];
  }

  const periodStart = Math.min(...timestamps);
  const buckets = new Map<number, OperationalEvent[]>();

  for (const event of events) {
    const timestamp = new Date(event.createdAt).valueOf();
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    const bucketIndex = Math.floor((timestamp - periodStart) / BUCKET_MS);
    const bucket = buckets.get(bucketIndex) ?? [];
    bucket.push(event);
    buckets.set(bucketIndex, bucket);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketIndex, bucket]) => {
      const metrics = aggregateEvents(bucket);
      const bucketStart = new Date(periodStart + bucketIndex * BUCKET_MS);

      return {
        date: bucketStart.toISOString(),
        label: new Intl.DateTimeFormat("ru-RU", {
          day: "2-digit",
          month: "short",
          timeZone: "UTC",
        })
          .format(bucketStart)
          .replace(".", ""),
        requests: metrics.requests,
        activeUsers: metrics.activeUsers,
        tokens: metrics.totalTokens,
        successRate: metrics.successRate,
        repeatRate: metrics.repeatRate,
      };
    });
}
