import type { OperationalEvent } from "@/lib/contracts/operational";

// Imported from the concrete modules rather than the barrel: this file is
// re-exported by the barrel, and a cycle through it leaves these bindings
// undefined at module init.
import { aggregateEvents } from "./aggregate";
import {
  classifyIntent,
  type ClassificationResult,
  type Taxonomy,
  type TaxonomyScenario,
} from "./classifier";
import { extractUserIntent } from "./intent";
import type { LlmClassifier } from "./llm-classifier";
import { runPipeline } from "./pipeline";
import {
  calculateRoi,
  type BandValue,
  type DemandSegment,
  type RoiResult,
} from "./roi";
import { rollupTasks, type RolledTask, type TaskRollup } from "./tasks";

export type GoldLabel = {
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

/**
 * The customer quotes inference at 139 ₽ per million tokens, so a thousand
 * tokens costs 0.139 ₽. At that price tokens are a rounding error next to
 * hardware amortization and the team — which is the point the dashboard has to
 * make, not hide.
 */
export const TOKEN_COST_PER_MILLION = 139;

/**
 * Fixed cost of running the agent for a 60-day sample. Everything here is an
 * assumption about the deployment, not a measurement of the log, so it is an
 * input a caller can replace — an uploaded log from another company has its own
 * team, hardware and licences.
 */
export interface FixedCostAssumptions {
  team: number;
  infrastructure: number;
  licenses: number;
  amortization: number;
}

export const DEMO_FIXED_COSTS_PER_60_DAYS: FixedCostAssumptions = {
  team: 150_000,
  infrastructure: 75_000,
  licenses: 150_000,
  amortization: 120_000,
};

const REFERENCE_PERIOD_DAYS = 60;

/**
 * The customer scales saved time by how long the replaced work session was:
 * 0.3 for a short exchange, 1 for a normal one, 2 for a long multi-step
 * session. Tool calls and retries are the only session-length evidence an
 * operational log carries, so they decide the bucket.
 */
const SESSION_LENGTH_FACTOR = {
  short: 0.3,
  medium: 1,
  long: 2,
} as const;

type SessionLength = keyof typeof SESSION_LENGTH_FACTOR;

/** Share of agent output a human still has to read and correct. */
const REVIEW_TAX: BandValue = { low: 0.5, base: 0.3, high: 0.15 };
const FEEDBACK_FACTOR: BandValue = { low: 0.85, base: 0.95, high: 0.99 };
const UNKNOWN_SCENARIO = "unknown";

export interface CheckpointInput {
  events: readonly OperationalEvent[];
  taxonomy: Taxonomy;
  /** Optional: without them the quality block reports nothing instead of guessing. */
  goldLabels?: readonly GoldLabel[];
  /** Optional worked example of intent extraction, shown next to the metrics. */
  ragSample?: RagSample | null;
  llm?: LlmClassifier | null;
  fixedCostsPer60Days?: FixedCostAssumptions;
  /** Names the origin of the data on screen, e.g. "Загруженный лог". */
  sourceLabel?: string;
}

export interface RagSample {
  note: string;
  request: { messages: { role: string; content: string }[] };
}

export type Checkpoint = Awaited<ReturnType<typeof buildCheckpoint>>;

export async function buildCheckpoint(input: CheckpointInput) {
  const { events, taxonomy } = input;
  const goldLabels = input.goldLabels ?? [];
  const pipeline = await runPipeline(
    events.map((event) => ({ id: event.id, request: event.request })),
    {
      taxonomy,
      llm: input.llm ?? null,
      tokenCostPerMillion: TOKEN_COST_PER_MILLION,
    },
  );
  const decisionById = new Map(
    pipeline.decisions.map((decision) => [decision.id, decision]),
  );
  const predictions: Prediction[] = events.map((event) => {
    const decision = decisionById.get(event.id);

    return {
      event,
      intent: decision?.intent ?? "",
      classification: decision?.classification ?? classifyIntent("", taxonomy),
    };
  });
  const classified: ClassifiedEvent[] = predictions.map(
    ({ event, classification }) => ({
      ...event,
      scenarioIds: classification.labels.map((label) => label.scenarioId),
      primaryScenarioId:
        classification.primary?.scenarioId ?? UNKNOWN_SCENARIO,
    }),
  );
  const period = getEventPeriod(events);
  const periodDays = periodLengthInDays(period);
  // Fixed cost is quoted for a 60-day sample, so a log covering a different
  // stretch of time gets it prorated. Charging a week of traffic with two
  // months of salary would make every short upload look catastrophic.
  const fixedCosts = prorateFixedCosts(
    input.fixedCostsPer60Days ?? DEMO_FIXED_COSTS_PER_60_DAYS,
    periodDays,
  );
  const aggregation = aggregateEvents(classified);

  // Demand is measured in tasks, not events: a reformulated request is the
  // same unit of work. Retry tokens stay in TCO, so retries cost money and
  // earn nothing instead of being subtracted from value twice.
  const tasks = rollupTasks(demandView(classified));
  const manualMinutes = manualMinutesResolver(taxonomy);
  const roi = calculateRoi(
    roiInput(classified, tasks.successRate, manualMinutes, {
      totalTokens: aggregation.totalTokens,
      fixedCosts,
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
        fixedCosts,
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
    source: input.sourceLabel ?? "Операционный лог",
    evidenceLevel: "request + tool trace + synthetic outcome",
    dataset: {
      events: aggregation.requests,
      tasks: tasks.taskCount,
      uniqueIntents: pipeline.cache.uniqueIntents,
      periodDays,
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
        sessionLength: sessionLengthMix(tasks),
        fixedCostsRub: fixedCosts,
        tokenCostPerThousandRub: TOKEN_COST_PER_MILLION / 1_000,
        tokenCostPerMillionRub: TOKEN_COST_PER_MILLION,
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
    pipeline: {
      layers: pipeline.layers,
      extraction: pipeline.extraction,
      cache: pipeline.cache,
      llm: pipeline.llm,
      costs: pipeline.costs,
      unresolved: pipeline.unresolved,
      note:
        "Каждый слой может отказаться отвечать. Запрос доходит до следующего только если предыдущий вернул UNKNOWN.",
    },
    discovery: {
      clusters: pipeline.discovery,
      note:
        "Группы запросов, которым таксономия не даёт названия. Кандидаты в новые сценарии.",
    },
    agents: aggregation.perAgent,
    departments: breakdown(
      aggregation.perDepartment,
      classified,
      (event) => event.department,
      manualMinutes,
      aggregation.totalTokens,
      fixedCosts,
    ),
    roles: breakdown(
      aggregation.perRole,
      classified,
      (event) => event.userRole,
      manualMinutes,
      aggregation.totalTokens,
      fixedCosts,
    ),
    trend: buildWeeklyTrend(events),
    topScenarios,
    intentExtractionDemo: input.ragSample
      ? intentExtractionDemo(taxonomy, input.ragSample)
      : null,
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
    toolCallCount: event.toolCalls.length,
  }));
}

/**
 * Steps the agent took on behalf of the user: every tool call plus every
 * reformulation after the first. Thresholds sit at the quantiles of this log —
 * roughly a third short, half normal, a fifth long — so "long" stays rare
 * enough to mean something instead of doubling half the estimate.
 */
function sessionLengthOf(task: RolledTask): SessionLength {
  const steps = task.toolCalls + task.attempts - 1;

  if (steps <= 1) {
    return "short";
  }

  return steps >= 5 ? "long" : "medium";
}

/**
 * Demand split by scenario *and* session length, so a one-line answer and a
 * ten-step investigation of the same scenario are not priced the same.
 */
function demandSegments(
  rollup: TaskRollup,
  manualMinutes: (scenarioId: string) => BandValue,
): DemandSegment[] {
  const counts = new Map<string, number>();

  for (const task of rollup.tasks) {
    const scenarioId = task.scenarioIds[0] ?? UNKNOWN_SCENARIO;
    const key = `${scenarioId}|${sessionLengthOf(task)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, requestCount]) => {
      const [scenarioId, length] = key.split("|") as [string, SessionLength];

      return {
        key,
        requestCount,
        manualMinutesPerRequest: manualMinutes(scenarioId),
        sessionLengthFactor: SESSION_LENGTH_FACTOR[length],
      };
    });
}

function sessionLengthMix(rollup: TaskRollup) {
  const counts: Record<SessionLength, number> = {
    short: 0,
    medium: 0,
    long: 0,
  };

  for (const task of rollup.tasks) {
    counts[sessionLengthOf(task)] += 1;
  }

  return { counts, factors: SESSION_LENGTH_FACTOR };
}

function roiInput(
  events: readonly ClassifiedEvent[],
  successRate: number,
  manualMinutes: (scenarioId: string) => BandValue,
  costs: {
    totalTokens: number;
    fixedCosts: FixedCostAssumptions | Record<string, number>;
  },
) {
  const rollup = rollupTasks(demandView(events));

  return {
    requestCount: rollup.taskCount,
    segments: demandSegments(rollup, manualMinutes),
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
    tokenCostPerThousand: TOKEN_COST_PER_MILLION / 1_000,
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
  fixedCosts: FixedCostAssumptions,
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
        Object.entries(fixedCosts).map(([key, value]) => [key, value * share]),
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
  fixedCosts: FixedCostAssumptions,
) {
  return Object.entries(metrics)
    .sort(([, left], [, right]) => right.requests - left.requests)
    .map(([name, slice]) => {
      const events = classified.filter((event) => getKey(event) === name);
      const rollup = rollupTasks(demandView(events));
      const sliceRoi = sliceEconomics(
        events,
        manualMinutes,
        totalTokens,
        fixedCosts,
      );

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

function intentExtractionDemo(taxonomy: Taxonomy, payload: RagSample) {
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

/**
 * The model layer only exists when the deployment configured a provider. With
 * no key the pipeline still runs end to end and reports how much traffic would
 * have reached the model — the number stays honest either way.
 */
function evaluate(
  predictions: readonly Prediction[],
  goldLabels: readonly GoldLabel[],
) {
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

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function getEventPeriod(events: readonly OperationalEvent[]) {
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

function countToolErrors(events: readonly OperationalEvent[]) {
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

function buildWeeklyTrend(events: readonly OperationalEvent[]) {
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

/**
 * Calendar span of the log, at least one day. A single-event log has zero span
 * but still cost something to run.
 */
function periodLengthInDays(period: { from: string | null; to: string | null }) {
  if (!period.from || !period.to) {
    return REFERENCE_PERIOD_DAYS;
  }

  const days =
    (new Date(period.to).valueOf() - new Date(period.from).valueOf()) /
    86_400_000;

  return Math.max(1, Math.round(days));
}

function prorateFixedCosts(
  costs: FixedCostAssumptions,
  periodDays: number,
): FixedCostAssumptions {
  const share = periodDays / REFERENCE_PERIOD_DAYS;

  return {
    team: costs.team * share,
    infrastructure: costs.infrastructure * share,
    licenses: costs.licenses * share,
    amortization: costs.amortization * share,
  };
}
