import {
  operationalEventSchema,
  type OperationalEvent,
} from "@/lib/contracts/operational";

/**
 * Reads an operational log the user dropped on the page.
 *
 * Accepts JSONL (one event per line) and a plain JSON array, because both are
 * what an export actually looks like. Bad lines are collected rather than
 * thrown: a log with three malformed records out of two thousand should still
 * produce a dashboard, with the damage stated.
 */

export interface ParsedDataset {
  events: OperationalEvent[];
  /** Human-readable reasons, capped — nobody reads the four hundredth one. */
  problems: string[];
  totalLines: number;
}

const MAX_REPORTED_PROBLEMS = 5;

export function parseOperationalLog(raw: string): ParsedDataset {
  const trimmed = raw.trim();

  if (!trimmed) {
    return { events: [], problems: ["Файл пустой."], totalLines: 0 };
  }

  const records = looksLikeJsonArray(trimmed)
    ? parseJsonArray(trimmed)
    : trimmed.split(/\r?\n/u).filter((line) => line.trim());

  if (typeof records === "string") {
    return { events: [], problems: [records], totalLines: 0 };
  }

  const events: OperationalEvent[] = [];
  const problems: string[] = [];
  let rejected = 0;

  records.forEach((record, index) => {
    const parsed = parseRecord(record);

    if (parsed.ok) {
      events.push(parsed.event);
      return;
    }

    rejected += 1;
    if (problems.length < MAX_REPORTED_PROBLEMS) {
      problems.push(`Строка ${index + 1}: ${parsed.reason}`);
    }
  });

  if (rejected > problems.length) {
    problems.push(`…и ещё ${rejected - problems.length} строк с ошибками.`);
  }

  if (events.length === 0 && problems.length === 0) {
    problems.push("Не нашлось ни одного события.");
  }

  return { events, problems, totalLines: records.length };
}

type RecordResult =
  | { ok: true; event: OperationalEvent }
  | { ok: false; reason: string };

function parseRecord(record: unknown): RecordResult {
  let value = record;

  if (typeof record === "string") {
    try {
      value = JSON.parse(record);
    } catch {
      return { ok: false, reason: "не разобрался как JSON" };
    }
  }

  const result = operationalEventSchema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".");
    return {
      ok: false,
      reason: where ? `поле ${where} — ${issue.message}` : "не тот формат",
    };
  }

  return { ok: true, event: result.data };
}

function looksLikeJsonArray(value: string): boolean {
  return value.startsWith("[");
}

function parseJsonArray(value: string): unknown[] | string {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : "Ожидался массив событий.";
  } catch {
    return "Файл начинается как JSON-массив, но не разобрался.";
  }
}
