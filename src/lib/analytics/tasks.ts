export type TaskOutcome = "success" | "partial" | "error" | "unknown";

export interface TaskEvent {
  id: string;
  createdAt?: string;
  timestamp?: string;
  outcome?: TaskOutcome;
  status?: TaskOutcome;
  repeatOf?: string;
  scenarioIds?: readonly string[];
  /** Tool calls this attempt made. Summed across the chain. */
  toolCallCount?: number;
}

export interface TaskMetrics {
  taskCount: number;
  succeeded: number;
  /** Tasks the user had to ask for more than once. */
  reworked: number;
  attempts: number;
  successRate: number;
  reworkRate: number;
  attemptsPerTask: number;
}

export interface RolledTask {
  scenarioIds: readonly string[];
  succeeded: boolean;
  attempts: number;
  toolCalls: number;
}

export interface TaskRollup extends TaskMetrics {
  perScenario: Record<string, TaskMetrics>;
  /** Individual tasks, for callers that need to segment demand further. */
  tasks: readonly RolledTask[];
}

const UNKNOWN_SCENARIO = "unknown";

/**
 * Collapses retry chains into business tasks.
 *
 * A user who reformulates the same request three times produced one unit of
 * demand, not three. Counting every event as new demand and then applying a
 * repeat penalty subtracts the same retries twice, so demand is measured here
 * and the extra tokens retries burned stay in TCO.
 *
 * The task inherits the scenario of its first attempt and the outcome of its
 * last one: what the user finally walked away with.
 */
export function rollupTasks(events: readonly TaskEvent[]): TaskRollup {
  const byId = new Map(events.map((event) => [event.id, event]));
  const chains = new Map<string, TaskEvent[]>();

  for (const event of events) {
    const rootId = resolveRootId(event, byId);
    const chain = chains.get(rootId) ?? [];
    chain.push(event);
    chains.set(rootId, chain);
  }

  const tasks = [...chains.entries()].map(([rootId, chain]) => {
    const ordered = [...chain].sort(compareByTime);
    const root = byId.get(rootId) ?? ordered[0];
    const last = ordered[ordered.length - 1];

    return {
      scenarioIds: scenariosOf(root),
      succeeded: outcomeOf(last) === "success",
      attempts: ordered.length,
      toolCalls: ordered.reduce(
        (sum, event) => sum + Math.max(0, event.toolCallCount ?? 0),
        0,
      ),
    };
  });

  return {
    ...measure(tasks),
    perScenario: perScenarioMetrics(tasks),
    tasks,
  };
}

function perScenarioMetrics(
  tasks: readonly RolledTask[],
): Record<string, TaskMetrics> {
  const groups = new Map<string, RolledTask[]>();

  for (const task of tasks) {
    for (const scenarioId of task.scenarioIds) {
      const group = groups.get(scenarioId) ?? [];
      group.push(task);
      groups.set(scenarioId, group);
    }
  }

  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scenarioId, group]) => [scenarioId, measure(group)]),
  );
}

function measure(tasks: readonly RolledTask[]): TaskMetrics {
  const taskCount = tasks.length;
  const succeeded = tasks.filter((task) => task.succeeded).length;
  const reworked = tasks.filter((task) => task.attempts > 1).length;
  const attempts = tasks.reduce((sum, task) => sum + task.attempts, 0);

  return {
    taskCount,
    succeeded,
    reworked,
    attempts,
    successRate: safeRate(succeeded, taskCount),
    reworkRate: safeRate(reworked, taskCount),
    attemptsPerTask: taskCount > 0 ? attempts / taskCount : 0,
  };
}

/**
 * Walks `repeatOf` to the original request. Missing parents and cycles fall
 * back to the current id so a malformed log cannot hang the rollup.
 */
function resolveRootId(
  event: TaskEvent,
  byId: ReadonlyMap<string, TaskEvent>,
): string {
  const seen = new Set<string>([event.id]);
  let current = event;

  while (current.repeatOf) {
    const parent = byId.get(current.repeatOf);
    if (!parent || seen.has(parent.id)) {
      return current.id;
    }
    seen.add(parent.id);
    current = parent;
  }

  return current.id;
}

function scenariosOf(event: TaskEvent | undefined): readonly string[] {
  const scenarioIds = [
    ...new Set(
      (event?.scenarioIds ?? [])
        .map((scenarioId) => scenarioId.trim())
        .filter(Boolean),
    ),
  ];

  return scenarioIds.length > 0 ? scenarioIds : [UNKNOWN_SCENARIO];
}

function outcomeOf(event: TaskEvent | undefined): TaskOutcome {
  return event?.outcome ?? event?.status ?? "unknown";
}

function compareByTime(left: TaskEvent, right: TaskEvent): number {
  const leftTime = timeOf(left);
  const rightTime = timeOf(right);

  if (leftTime === rightTime) {
    return left.id.localeCompare(right.id);
  }

  return leftTime - rightTime;
}

function timeOf(event: TaskEvent): number {
  const parsed = new Date(event.createdAt ?? event.timestamp ?? "").valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
