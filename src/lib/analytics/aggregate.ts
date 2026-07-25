export type AnalyticsEventStatus = "success" | "error" | "unknown";

export interface AnalyticsToolCall {
  name?: string;
  status?: "success" | "error" | "unknown";
}

export interface AnalyticsEvent {
  id: string;
  timestamp?: string;
  createdAt?: string;
  userId?: string;
  department?: string;
  agentName?: string;
  scenarioIds?: readonly string[];
  status?: AnalyticsEventStatus;
  outcome?: AnalyticsEventStatus | "partial";
  isRepeat?: boolean;
  repeatOf?: string;
  inputTokens?: number;
  outputTokens?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  toolCalls?: number | readonly AnalyticsToolCall[];
}

export interface AggregateMetrics {
  requests: number;
  activeUsers: number;
  mau: number;
  monthlyActiveUsers: Record<string, number>;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  successes: number;
  partials: number;
  errors: number;
  unknownOutcomes: number;
  repeats: number;
  successRate: number;
  repeatRate: number;
}

export interface EventAggregation extends AggregateMetrics {
  perAgent: Record<string, AggregateMetrics>;
  perScenario: Record<string, AggregateMetrics>;
}

const UNKNOWN_AGENT = "unknown";
const UNKNOWN_SCENARIO = "unknown";

export function aggregateEvents(
  events: readonly AnalyticsEvent[],
): EventAggregation {
  return {
    ...aggregateSlice(events),
    perAgent: aggregateGroups(events, (event) => [
      normalizeGroup(event.agentName, UNKNOWN_AGENT),
    ]),
    perScenario: aggregateGroups(events, (event) => {
      const scenarioIds = unique(
        (event.scenarioIds ?? [])
          .map((scenarioId) => scenarioId.trim())
          .filter(Boolean),
      );
      return scenarioIds.length > 0 ? scenarioIds : [UNKNOWN_SCENARIO];
    }),
  };
}

function aggregateGroups(
  events: readonly AnalyticsEvent[],
  getKeys: (event: AnalyticsEvent) => readonly string[],
): Record<string, AggregateMetrics> {
  const groups = new Map<string, AnalyticsEvent[]>();

  for (const event of events) {
    for (const key of getKeys(event)) {
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
    }
  }

  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, group]) => [key, aggregateSlice(group)]),
  );
}

function aggregateSlice(
  events: readonly AnalyticsEvent[],
): AggregateMetrics {
  const activeUsers = new Set<string>();
  const usersByMonth = new Map<string, Set<string>>();
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let successes = 0;
  let partials = 0;
  let errors = 0;
  let unknownOutcomes = 0;
  let repeats = 0;

  for (const event of events) {
    const userId = event.userId?.trim();
    const month = getUtcMonth(event.timestamp ?? event.createdAt ?? "");

    if (userId) {
      activeUsers.add(userId);
      if (month) {
        const users = usersByMonth.get(month) ?? new Set<string>();
        users.add(userId);
        usersByMonth.set(month, users);
      }
    }

    toolCalls += countToolCalls(event.toolCalls);
    inputTokens += integerOrZero(
      event.inputTokens ?? event.usage?.inputTokens,
    );
    outputTokens += integerOrZero(
      event.outputTokens ?? event.usage?.outputTokens,
    );

    const outcome = event.status ?? event.outcome ?? "unknown";
    if (outcome === "success") {
      successes += 1;
    } else if (outcome === "partial") {
      partials += 1;
    } else if (outcome === "error") {
      errors += 1;
    } else {
      unknownOutcomes += 1;
    }

    if (event.isRepeat === true || Boolean(event.repeatOf?.trim())) {
      repeats += 1;
    }
  }

  const monthlyActiveUsers = Object.fromEntries(
    [...usersByMonth.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, users]) => [month, users.size]),
  );
  const monthlyCounts = Object.values(monthlyActiveUsers);

  return {
    requests: events.length,
    activeUsers: activeUsers.size,
    // For a multi-month slice MAU is the average of the monthly unique counts.
    mau:
      monthlyCounts.length > 0
        ? monthlyCounts.reduce((sum, count) => sum + count, 0) /
          monthlyCounts.length
        : 0,
    monthlyActiveUsers,
    toolCalls,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    successes,
    partials,
    errors,
    unknownOutcomes,
    repeats,
    successRate: safeRate(successes, events.length),
    repeatRate: safeRate(repeats, events.length),
  };
}

function getUtcMonth(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

function countToolCalls(
  toolCalls: number | readonly AnalyticsToolCall[] | undefined,
): number {
  if (Array.isArray(toolCalls)) {
    return toolCalls.length;
  }
  return integerOrZero(
    typeof toolCalls === "number" ? toolCalls : undefined,
  );
}

function integerOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function normalizeGroup(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
