/**
 * Turns the log into a repair list.
 *
 * The dashboard already says how much value is lost. This says where and why,
 * as a grid of scenarios against failure modes: rows ordered by the money they
 * leak, columns naming the failure that produced it. A reader should be able to
 * start at the top row and work down.
 *
 * Every cell carries its own numerator and denominator. A rate without them is
 * how a scenario with three requests ends up looking like the biggest problem
 * in the company.
 */

export type ProblemKey =
  | "noResult"
  | "rework"
  | "toolErrors"
  | "negativeFeedback"
  | "slowResponses";

export type Severity = "ok" | "watch" | "act";

export interface ProblemColumn {
  key: ProblemKey;
  title: string;
  /** What a high value means, shown on hover. */
  meaning: string;
}

export interface ProblemCell {
  key: ProblemKey;
  rate: number;
  numerator: number;
  denominator: number;
  severity: Severity;
}

export interface ProblemRow {
  key: string;
  title: string;
  tasks: number;
  valueGapRub: number;
  cells: ProblemCell[];
  /** The failure mode that costs this row the most attention, if any. */
  worst: ProblemKey | null;
}

export interface ProblemEvent {
  scenarioId: string;
  toolCalls: number;
  toolErrors: number;
  feedback: number | null;
  latencyMs: number;
}

export interface ProblemScenarioInput {
  key: string;
  title: string;
  tasks: number;
  failedTasks: number;
  reworkedTasks: number;
  valueGapRub: number;
  events: readonly ProblemEvent[];
}

export const PROBLEM_COLUMNS: readonly ProblemColumn[] = [
  {
    key: "noResult",
    title: "Без результата",
    meaning: "Задача закончилась ошибкой или частичным ответом",
  },
  {
    key: "rework",
    title: "Переспросы",
    meaning: "Пользователь переформулировал запрос хотя бы раз",
  },
  {
    key: "toolErrors",
    title: "Ошибки инструментов",
    meaning: "Вызов внешней системы вернул ошибку",
  },
  {
    key: "negativeFeedback",
    title: "Негативный feedback",
    meaning: "Пользователь явно отметил ответ как плохой",
  },
  {
    key: "slowResponses",
    title: "Медленные ответы",
    meaning: "Ответ дольше общего p95 по всему логу",
  },
];

/**
 * Severity is measured against the log's own baseline rather than a fixed
 * number, because "normal" is a property of the deployment. A 15 % rework rate
 * is alarming where the rest of the log sits at 4 % and unremarkable where
 * everything sits at 14 %. Fixed thresholds would flag every row in one company
 * and none in another, which is how a heatmap turns into decoration.
 */
const WATCH_MULTIPLIER = 1.3;
const ACT_MULTIPLIER = 1.75;

/**
 * Below this rate nothing is flagged no matter how far above baseline it sits.
 * Without a floor, a log with a 0.2 % error rate would paint 0.5 % red.
 */
const NOISE_FLOOR: Record<ProblemKey, number> = {
  noResult: 0.15,
  rework: 0.05,
  toolErrors: 0.03,
  negativeFeedback: 0.03,
  slowResponses: 0.05,
};

/**
 * Below this many observations a rate is noise, so the cell can warn but never
 * demand action. Nothing is hidden — the counts stay visible either way.
 */
const MINIMUM_CONFIDENT_SAMPLE = 20;

export function buildProblemGrid(
  scenarios: readonly ProblemScenarioInput[],
  slowThresholdMs: number,
): ProblemRow[] {
  const counted = scenarios.map((scenario) =>
    countRow(scenario, slowThresholdMs),
  );
  const baselines = pooledBaselines(counted);

  return counted
    .map((row) => gradeRow(row, baselines))
    .sort(
      (left, right) =>
        right.valueGapRub - left.valueGapRub ||
        left.title.localeCompare(right.title),
    );
}

interface CountedRow {
  key: string;
  title: string;
  tasks: number;
  valueGapRub: number;
  counts: { key: ProblemKey; numerator: number; denominator: number }[];
}

/** Pooled rate per column: the log's overall behaviour, not a mean of rates. */
function pooledBaselines(
  rows: readonly CountedRow[],
): Record<ProblemKey, number> {
  const totals = new Map<ProblemKey, { numerator: number; denominator: number }>();

  for (const row of rows) {
    for (const count of row.counts) {
      const total = totals.get(count.key) ?? { numerator: 0, denominator: 0 };
      total.numerator += count.numerator;
      total.denominator += count.denominator;
      totals.set(count.key, total);
    }
  }

  return Object.fromEntries(
    PROBLEM_COLUMNS.map((column) => {
      const total = totals.get(column.key);
      const rate =
        total && total.denominator > 0
          ? total.numerator / total.denominator
          : 0;
      return [column.key, rate];
    }),
  ) as Record<ProblemKey, number>;
}

function gradeRow(
  row: CountedRow,
  baselines: Record<ProblemKey, number>,
): ProblemRow {
  const cells = row.counts.map((count) =>
    cell(count.key, count.numerator, count.denominator, baselines[count.key]),
  );

  return {
    key: row.key,
    title: row.title,
    tasks: row.tasks,
    valueGapRub: row.valueGapRub,
    cells,
    worst: worstCell(cells, baselines),
  };
}

function countRow(
  scenario: ProblemScenarioInput,
  slowThresholdMs: number,
): CountedRow {
  const events = scenario.events;
  const toolCalls = events.reduce((sum, event) => sum + event.toolCalls, 0);
  const toolErrors = events.reduce((sum, event) => sum + event.toolErrors, 0);
  const rated = events.filter((event) => event.feedback !== null);
  const negative = rated.filter((event) => (event.feedback ?? 0) < 0).length;
  const slow = events.filter(
    (event) => event.latencyMs > slowThresholdMs,
  ).length;

  return {
    key: scenario.key,
    title: scenario.title,
    tasks: scenario.tasks,
    valueGapRub: scenario.valueGapRub,
    counts: [
      {
        key: "noResult",
        numerator: scenario.failedTasks,
        denominator: scenario.tasks,
      },
      {
        key: "rework",
        numerator: scenario.reworkedTasks,
        denominator: scenario.tasks,
      },
      { key: "toolErrors", numerator: toolErrors, denominator: toolCalls },
      {
        key: "negativeFeedback",
        numerator: negative,
        denominator: rated.length,
      },
      { key: "slowResponses", numerator: slow, denominator: events.length },
    ],
  };
}

function cell(
  key: ProblemKey,
  numerator: number,
  denominator: number,
  baseline: number,
): ProblemCell {
  const rate = denominator > 0 ? numerator / denominator : 0;
  const confident = denominator >= MINIMUM_CONFIDENT_SAMPLE;
  const aboveNoise = rate >= NOISE_FLOOR[key];
  const ratio = baseline > 0 ? rate / baseline : 0;

  const severity: Severity = !aboveNoise
    ? "ok"
    : ratio >= ACT_MULTIPLIER && confident
      ? "act"
      : ratio >= WATCH_MULTIPLIER
        ? "watch"
        : "ok";

  return { key, rate, numerator, denominator, severity };
}

/**
 * The single failure mode worth naming for this row: the most severe one, and
 * among equally severe ones the furthest above its own baseline. Comparing raw
 * rates across columns would always pick whichever metric runs high everywhere.
 */
function worstCell(
  cells: readonly ProblemCell[],
  baselines: Record<ProblemKey, number>,
): ProblemKey | null {
  const ranked = cells
    .filter((candidate) => candidate.severity !== "ok")
    .sort((left, right) => {
      const bySeverity =
        severityRank(right.severity) - severityRank(left.severity);
      if (bySeverity !== 0) {
        return bySeverity;
      }
      return excess(right, baselines) - excess(left, baselines);
    });

  return ranked[0]?.key ?? null;
}

function excess(
  candidate: ProblemCell,
  baselines: Record<ProblemKey, number>,
): number {
  const baseline = baselines[candidate.key];
  return baseline > 0 ? candidate.rate / baseline : 0;
}

function severityRank(severity: Severity): number {
  return severity === "act" ? 2 : severity === "watch" ? 1 : 0;
}
