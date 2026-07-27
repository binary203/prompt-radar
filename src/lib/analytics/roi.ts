export type EstimateBand = "low" | "base" | "high";

export interface BandValue {
  low: number;
  base: number;
  high: number;
}

export type AdjustableValue = number | BandValue;

export interface OutcomeAssumptions {
  successRate: AdjustableValue;
  /**
   * Optional. Only meaningful when `requestCount` still contains retries.
   * When demand is already collapsed to unique tasks, leave it unset —
   * otherwise repeats are subtracted twice.
   */
  repeatRate?: AdjustableValue;
  reviewTax: AdjustableValue;
  feedbackFactor: AdjustableValue;
}

/**
 * One slice of demand with its own manual-work estimate, e.g. a business
 * scenario. Potential value is the sum over slices, so an expensive rare
 * scenario is not averaged away by a cheap frequent one.
 */
export interface DemandSegment {
  key?: string;
  requestCount: number;
  manualMinutesPerRequest: AdjustableValue;
  /**
   * How much of a work session this slice replaced. Defaults to 1. A short
   * question-and-answer saves a fraction of the scenario's manual time; a long
   * multi-step session can save more than one pass of it.
   */
  sessionLengthFactor?: AdjustableValue;
}

export interface FixedCosts {
  team?: number;
  infrastructure?: number;
  licenses?: number;
  amortization?: number;
  other?: number;
}

export interface RoiInput {
  requestCount: number;
  /** Flat estimate. Ignored when `segments` is provided. */
  manualMinutesPerRequest?: AdjustableValue;
  segments?: readonly DemandSegment[];
  sessionLengthFactor?: AdjustableValue;
  outcome: OutcomeAssumptions;
  totalTokens?: number;
  tokenCostPerThousand?: number;
  fixedCosts?: FixedCosts;
  fteMonthlyCost?: number;
  workingHoursPerMonth?: number;
}

export interface TcoBreakdown {
  tokenCost: number;
  fixedCost: number;
  team: number;
  infrastructure: number;
  licenses: number;
  amortization: number;
  other: number;
  total: number;
}

export interface RoiBandResult {
  potentialMinutes: number;
  realizedMinutes: number;
  /** Weighted average across segments, for display next to the assumptions. */
  effectiveManualMinutes: number;
  fteMonthsPotential: number;
  fteMonthsRealized: number;
  potentialValue: number;
  realizedValue: number;
  valueGap: number;
  outcomeYield: number;
  netValue: number;
  roi: number | null;
  returnPerRuble: number | null;
  estimatedSuccessfulOutcomes: number;
  costPerSuccessfulOutcome: number | null;
  profitable: boolean;
}

export interface RoiResult {
  assumptions: {
    fteMonthlyCost: number;
    workingHoursPerMonth: number;
    rublesPerMinute: number;
  };
  tco: TcoBreakdown;
  low: RoiBandResult;
  base: RoiBandResult;
  high: RoiBandResult;
}

const DEFAULT_FTE_MONTHLY_COST = 400_000;
const DEFAULT_WORKING_HOURS_PER_MONTH = 160;
const BANDS: readonly EstimateBand[] = ["low", "base", "high"];

/**
 * Calculates a sensitivity range for Potential → Realized Value.
 *
 * Fixed costs remain separate from marginal token costs to avoid double
 * counting. Rates are clamped to 0..1; monetary inputs are clamped at zero.
 */
export function calculateRoi(input: RoiInput): RoiResult {
  const requestCount = nonNegative(input.requestCount);
  const fteMonthlyCost = nonNegative(
    input.fteMonthlyCost ?? DEFAULT_FTE_MONTHLY_COST,
  );
  const workingHoursPerMonth = positiveOrDefault(
    input.workingHoursPerMonth,
    DEFAULT_WORKING_HOURS_PER_MONTH,
  );
  const rublesPerMinute =
    fteMonthlyCost / (workingHoursPerMonth * 60);
  const tco = calculateTco(input);

  const results = Object.fromEntries(
    BANDS.map((band) => [
      band,
      calculateBand(
        band,
        input,
        requestCount,
        rublesPerMinute,
        workingHoursPerMonth,
        tco.total,
      ),
    ]),
  ) as Record<EstimateBand, RoiBandResult>;

  return {
    assumptions: {
      fteMonthlyCost,
      workingHoursPerMonth,
      rublesPerMinute,
    },
    tco,
    ...results,
  };
}

function calculateTco(input: RoiInput): TcoBreakdown {
  const totalTokens = nonNegative(input.totalTokens ?? 0);
  const tokenCostPerThousand = nonNegative(
    input.tokenCostPerThousand ?? 0,
  );
  const fixedCosts = input.fixedCosts ?? {};
  const team = nonNegative(fixedCosts.team ?? 0);
  const infrastructure = nonNegative(fixedCosts.infrastructure ?? 0);
  const licenses = nonNegative(fixedCosts.licenses ?? 0);
  const amortization = nonNegative(fixedCosts.amortization ?? 0);
  const other = nonNegative(fixedCosts.other ?? 0);
  const tokenCost = (totalTokens / 1_000) * tokenCostPerThousand;
  const fixedCost =
    team + infrastructure + licenses + amortization + other;

  return {
    tokenCost,
    fixedCost,
    team,
    infrastructure,
    licenses,
    amortization,
    other,
    total: tokenCost + fixedCost,
  };
}

function calculateBand(
  band: EstimateBand,
  input: RoiInput,
  requestCount: number,
  rublesPerMinute: number,
  workingHoursPerMonth: number,
  tco: number,
): RoiBandResult {
  const sessionLengthFactor = nonNegative(
    readBand(input.sessionLengthFactor ?? 1, band),
  );
  const successRate = rate(readBand(input.outcome.successRate, band));
  const repeatRate = rate(readBand(input.outcome.repeatRate ?? 0, band));
  const reviewTax = rate(readBand(input.outcome.reviewTax, band));
  const feedbackFactor = rate(
    readBand(input.outcome.feedbackFactor, band),
  );
  const baseMinutes = segmentMinutes(input, band, requestCount);
  const potentialMinutes = baseMinutes * sessionLengthFactor;
  const effectiveManualMinutes =
    requestCount > 0 ? baseMinutes / requestCount : 0;
  const outcomeYield =
    successRate *
    (1 - repeatRate) *
    (1 - reviewTax) *
    feedbackFactor;
  const realizedMinutes = potentialMinutes * outcomeYield;
  const potentialValue = potentialMinutes * rublesPerMinute;
  const realizedValue = potentialValue * outcomeYield;
  const valueGap = potentialValue - realizedValue;
  const netValue = realizedValue - tco;
  const estimatedSuccessfulOutcomes =
    requestCount * successRate * (1 - repeatRate) * (1 - reviewTax);
  const minutesPerFteMonth = workingHoursPerMonth * 60;

  return {
    potentialMinutes,
    realizedMinutes,
    effectiveManualMinutes,
    fteMonthsPotential: potentialMinutes / minutesPerFteMonth,
    fteMonthsRealized: realizedMinutes / minutesPerFteMonth,
    potentialValue,
    realizedValue,
    valueGap,
    outcomeYield,
    netValue,
    roi: safeRatio(netValue, tco),
    returnPerRuble: safeRatio(realizedValue, tco),
    estimatedSuccessfulOutcomes,
    costPerSuccessfulOutcome: safeRatio(
      tco,
      estimatedSuccessfulOutcomes,
    ),
    profitable: realizedValue > tco,
  };
}

/**
 * Manual minutes before the global session-length factor. Segments are summed
 * so an expensive rare scenario keeps its weight and each slice may carry its
 * own session-length factor; a flat estimate is the fallback.
 */
function segmentMinutes(
  input: RoiInput,
  band: EstimateBand,
  requestCount: number,
): number {
  const segments = input.segments;

  if (segments && segments.length > 0) {
    return segments.reduce(
      (total, segment) =>
        total +
        nonNegative(segment.requestCount) *
          nonNegative(readBand(segment.manualMinutesPerRequest, band)) *
          nonNegative(readBand(segment.sessionLengthFactor ?? 1, band)),
      0,
    );
  }

  return (
    requestCount *
    nonNegative(readBand(input.manualMinutesPerRequest ?? 0, band))
  );
}

function readBand(value: AdjustableValue, band: EstimateBand): number {
  return typeof value === "number" ? value : value[band];
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function rate(value: number): number {
  return Math.min(1, nonNegative(value));
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }

  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}
