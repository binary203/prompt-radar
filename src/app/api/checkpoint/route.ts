import { readFile } from "node:fs/promises";
import path from "node:path";

import ragPayloadSample from "@/data/synthetic/rag-payload-sample.json";
import taxonomyData from "@/data/synthetic/taxonomy.json";
import {
  aggregateEvents,
  calculateRoi,
  classifyIntent,
  extractUserIntent,
  rollupTasks,
  type BandValue,
  type ClassificationResult,
  type DemandSegment,
  type RoiResult,
  type Taxonomy,
  type TaxonomyScenario,
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

/** An event after classification, ready for demand and economics rollups. */
type ClassifiedEvent = OperationalEvent & {
  scenarioIds: string[];
  primaryScenarioId: string;
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

/** Share of agent output a human still has to read and correct. */
const REVIEW_TAX: BandValue = { low: 0.5, base: 0.3, high: 0.15 };
const FEEDBACK_FACTOR: BandValue = { low: 0.85, base: 0.95, high: 0.99 };
const UNKNOWN_SCENARIO = "unknown";

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
  const classified: ClassifiedEvent[] = predictions.map(
    ({ event, classification }) => ({
      ...event,
      scenarioIds: classification.labels.map((label) => label.scenarioId),
      primaryScenarioId:
        classification.primary?.scenarioId ?? UNKNOWN_SCENARIO,
    }),
  );
  const period = getEventPeriod(events);
  const aggregation = aggregateEvents(classified);

  // Demand is measured in tasks, not events: a reformulated request is the
  // same unit of work. Retry tokens stay in TCO, so retries cost money and
  // earn nothing instead of being subtracted from value twice.
  const tasks = rollupTasks(demandView(classified));
  const manualMinutes = manualMinutesResolver(taxonomy);
  const roi = calculateRoi(
    roiInput(classified, tasks.successRate, manualMinutes, {
      totalTokens: aggregation.totalTokens,
      fixedCosts: DEMO_COSTS.fixedCostsFor60DaySample,
    }),
  );

  const scenarioById = new Map(
    taxonomy.scenarios.map((scenario) => [scenario.scenario_id, scenario]),
  );
  const topScenarios = Object.entries(aggregation.perScenario)
    .filter(([scenarioId]) => scenarioId !== UNKNOWN_SCENARIO)
    .sort(([, left], [, right]) => right.requests - left.requests)
    .slice(0, 6)
    .map(([scenarioId, metrics]) => {
      const slice = classified.filter((event) =>
        event.scenarioIds.includes(scenarioId),
      );
      const sliceRoi = sliceEconomics(
        slice,
        manualMinutes,
        aggregation.totalTokens,
      );

      return {
        id: scenarioId,
        title: scenarioById.get(scenarioId)?.title_ru ?? scenarioId,
        requests: metrics.requests,
        tasks: tasks.perScenario[scenarioId]?.taskCount ?? 0,
        successRate: metrics.successRate,
        repeatRate: metrics.repeatRate,
        tokens: metrics.totalTokens,
        manualMinutes: manualMinutes(scenarioId).base,
        potentialValueRub: sliceRoi.base.potentialValue,
        realizedValueRub: sliceRoi.base.realizedValue,
        valueGapRub: sliceRoi.base.valueGap,
      };
    });

  const checkpoint = {
    generatedAt: new Date().toISOString(),
    mode: "synthetic-checkpoint",
    evidenceLevel: "request + tool trace + synthetic outcome",
    dataset: {
      events: aggregation.requests,
      tasks: tasks.taskCount,
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
    tasks: {
      count: tasks.taskCount,
      succeeded: tasks.succeeded,
      reworked: tasks.reworked,
      successRate: tasks.successRate,
      reworkRate: tasks.reworkRate,
      attemptsPerTask: tasks.attemptsPerTask,
      note:
        "Задача — исходный запрос вместе со всеми переформулировками. Спрос считается по задачам, повторные попытки остаются в стоимости.",
    },
    economics: {
      assumptions: {
        monthlyFteCostRub: roi.assumptions.fteMonthlyCost,
        workingHoursPerMonth: roi.assumptions.workingHoursPerMonth,
        taskCount: tasks.taskCount,
        manualMinutesSource: "посценарная экспертная оценка из taxonomy.json",
        effectiveManualMinutesPerTask: {
          low: roi.low.effectiveManualMinutes,
          base: roi.base.effectiveManualMinutes,
          high: roi.high.effectiveManualMinutes,
        },
        reviewTax: REVIEW_TAX,
        feedbackFactor: FEEDBACK_FACTOR,
        costsFor60DayDemoSampleRub: DEMO_COSTS.fixedCostsFor60DaySample,
        tokenCostPerThousandRub: DEMO_COSTS.tokenCostPerThousand,
      },
      potentialValueRub: bandOf(roi, (result) => result.potentialValue),
      realizedValueRub: bandOf(roi, (result) => result.realizedValue),
      valueGapRub: bandOf(roi, (result) => result.valueGap),
      tcoRub: roi.tco,
      roi: {
        low: roi.low.roi,
        base: roi.base.roi,
        high: roi.high.roi,
      },
      returnPerRuble: {
        low: roi.low.returnPerRuble,
        base: roi.base.returnPerRuble,
        high: roi.high.returnPerRuble,
      },
      fteMonthsRealized: bandOf(
        roi,
        (result) => result.fteMonthsRealized,
      ),
      fteMonthsPotential: bandOf(
        roi,
        (result) => result.fteMonthsPotential,
      ),
    },
    evaluation: evaluate(predictions, goldLabels),
    agents: aggregation.perAgent,
    departments: breakdown(
      aggregation.perDepartment,
      classified,
      (event) => event.department,
      manualMinutes,
      aggregation.totalTokens,
    ),
    roles: breakdown(
      aggregation.perRole,
      classified,
      (event) => event.userRole,
      manualMinutes,
      aggregation.totalTokens,
    ),
    trend: buildWeeklyTrend(events),
    topScenarios,
    intentExtractionDemo: intentExtractionDemo(taxonomy),
    disclaimer:
      "Финансовые значения — proxy для воспроизводимости формул на синтетике: спрос считается по задачам, ручное время задано посценарным диапазоном, TCO аллоцирован на 60-дневную выборку. Боевой ROI требует калибровки КРОК.",
  };

  return checkpoint;
}

/**
 * Only the primary label defines demand. Keeping every label here would let a
 * multi-intent request be counted once per scenario and inflate potential.
 */
function demandView(events: readonly ClassifiedEvent[]) {
  return events.map((event) => ({
    ...event,
    scenarioIds: [event.primaryScenarioId],
  }));
}

function roiInput(
  events: readonly ClassifiedEvent[],
  successRate: number,
  manualMinutes: (scenarioId: string) => BandValue,
  costs: {
    totalTokens: number;
    fixedCosts: Record<string, number>;
  },
) {
  const rollup = rollupTasks(demandView(events));
  const segments: DemandSegment[] = Object.entries(rollup.perScenario).map(
    ([scenarioId, metrics]) => ({
      key: scenarioId,
      requestCount: metrics.taskCount,
      manualMinutesPerRequest: manualMinutes(scenarioId),
    }),
  );

  return {
    requestCount: rollup.taskCount,
    segments,
    outcome: {
      successRate: {
        low: Math.max(0, successRate * 0.85),
        base: successRate,
        high: Math.min(1, successRate * 1.1),
      },
      reviewTax: REVIEW_TAX,
      feedbackFactor: FEEDBACK_FACTOR,
    },
    totalTokens: costs.totalTokens,
    tokenCostPerThousand: DEMO_COSTS.tokenCostPerThousand,
    fixedCosts: costs.fixedCosts,
  };
}

/**
 * Economics for a slice (scenario, department, role). Fixed costs follow the
 * slice's token share, so a cheap slice is not charged for an expensive one.
 */
function sliceEconomics(
  slice: readonly ClassifiedEvent[],
  manualMinutes: (scenarioId: string) => BandValue,
  totalTokens: number,
): RoiResult {
  const sliceTokens = slice.reduce(
    (sum, event) => sum + event.usage.totalTokens,
    0,
  );
  const share = totalTokens > 0 ? sliceTokens / totalTokens : 0;
  const rollup = rollupTasks(demandView(slice));

  return calculateRoi(
    roiInput(slice, rollup.successRate, manualMinutes, {
      totalTokens: sliceTokens,
      fixedCosts: Object.fromEntries(
        Object.entries(DEMO_COSTS.fixedCostsFor60DaySample).map(
          ([key, value]) => [key, value * share],
        ),
      ),
    }),
  );
}

function breakdown(
  metrics: Record<
    string,
    { requests: number; activeUsers: number; totalTokens: number; successRate: number }
  >,
  classified: readonly ClassifiedEvent[],
  getKey: (event: ClassifiedEvent) => string | undefined,
  manualMinutes: (scenarioId: string) => BandValue,
  totalTokens: number,
) {
  return Object.entries(metrics)
    .sort(([, left], [, right]) => right.requests - left.requests)
    .map(([name, slice]) => {
      const events = classified.filter((event) => getKey(event) === name);
      const rollup = rollupTasks(demandView(events));
      const sliceRoi = sliceEconomics(events, manualMinutes, totalTokens);

      return {
        name,
        requests: slice.requests,
        tasks: rollup.taskCount,
        activeUsers: slice.activeUsers,
        tokens: slice.totalTokens,
        successRate: rollup.successRate,
        reworkRate: rollup.reworkRate,
        realizedValueRub: sliceRoi.base.realizedValue,
        valueGapRub: sliceRoi.base.valueGap,
        fteMonthsRealized: sliceRoi.base.fteMonthsRealized,
        netValueRub: sliceRoi.base.netValue,
      };
    });
}

/**
 * UNKNOWN requests get the cheapest known scenario, never an average: an
 * unclassified request must not be able to inflate the business case.
 */
function manualMinutesResolver(
  taxonomy: Taxonomy,
): (scenarioId: string) => BandValue {
  const byId = new Map<string, BandValue>();
  let floor: BandValue = { low: 5, base: 10, high: 15 };

  for (const scenario of taxonomy.scenarios as readonly TaxonomyScenario[]) {
    if (!scenario.manual_minutes) {
      continue;
    }
    byId.set(scenario.scenario_id, scenario.manual_minutes);
    if (scenario.manual_minutes.base < floor.base) {
      floor = scenario.manual_minutes;
    }
  }

  return (scenarioId: string) => byId.get(scenarioId) ?? floor;
}

function intentExtractionDemo(taxonomy: Taxonomy) {
  const payload = ragPayloadSample as {
    note: string;
    request: { messages: { role: string; content: string }[] };
  };
  const sourceChars = payload.request.messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  const extracted = extractUserIntent(payload.request);
  const classification = classifyIntent(extracted, taxonomy);

  return {
    note: payload.note,
    sourceChars,
    extractedChars: extracted.length,
    compressionRatio: extracted.length > 0 ? sourceChars / extracted.length : 0,
    extracted,
    routed: classification.isUnknown
      ? "UNKNOWN: кандидат на LLM-разбор"
      : `${classification.primary?.scenarioId} (${formatConfidence(classification.confidence)})`,
  };
}

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function bandOf(
  roi: RoiResult,
  read: (result: RoiResult["base"]) => number,
): BandValue {
  return {
    low: read(roi.low),
    base: read(roi.base),
    high: read(roi.high),
  };
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
