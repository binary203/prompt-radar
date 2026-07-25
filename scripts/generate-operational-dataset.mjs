import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "src", "data", "synthetic");
const SOURCE_DIR = "/tmp/prompt-radar-dataset";
const EVENT_COUNT = 1_500;
const RAG_COUNT = 300;
const SEED = 0xc0c02026;
const START_AT = Date.parse("2026-05-26T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const END_AT = START_AT + 60 * DAY_MS - 1;

const MANUAL_MINUTES = {
  email_digest: 28,
  email_monitoring: 22,
  client_correspondence: 24,
  tickets_from_inbox: 18,
  crm_client_intel: 42,
  won_tenders_reporting: 55,
  data_export_excel: 48,
  company_market_research: 95,
  performance_feedback: 34,
  hr_observations: 12,
  isup_management: 20,
  personal_task_management: 16,
  knowledge_search: 27,
  calendar_scheduling: 26,
  meeting_prep: 22,
  meeting_notes: 31,
};

const TOOL_NAMES = {
  email: ["email.search", "email.read_thread", "email.create_draft"],
  crm: ["crm.search_client", "crm.read_deals", "crm.update_record"],
  project_systems: [
    "projects.search_issues",
    "projects.create_issue",
    "projects.update_issue",
  ],
  task_tracker: [
    "tasks.list",
    "tasks.create",
    "tasks.update_status",
  ],
  hr: ["hr.search_employee", "hr.read_profile", "hr.create_note"],
  calendar: [
    "calendar.find_availability",
    "calendar.list_events",
    "calendar.create_event",
  ],
  knowledge_base: [
    "knowledge.search",
    "knowledge.read_page",
    "knowledge.get_metadata",
  ],
  spreadsheets: [
    "spreadsheets.create",
    "spreadsheets.write_rows",
    "spreadsheets.export",
  ],
  public_sources: [
    "browser.search",
    "browser.open_page",
    "browser.extract_text",
  ],
};

const UNKNOWN_PERSONAS = [
  { userRole: "сотрудник", department: "Разработка" },
  { userRole: "менеджер по продажам", department: "Продажи" },
  { userRole: "аналитик", department: "Аналитика" },
  { userRole: "руководитель", department: "Управление" },
  { userRole: "сотрудник", department: "Финансы" },
];

const DEPARTMENT_CODES = {
  Аналитика: "analytics",
  Закупки: "procurement",
  Маркетинг: "marketing",
  Поддержка: "support",
  Продажи: "sales",
  Разработка: "engineering",
  Управление: "management",
  "Управление проектами": "pmo",
  Финансы: "finance",
};

const ROLE_CODES = {
  аналитик: "analyst",
  "менеджер по продажам": "sales_manager",
  "помощник руководителя": "executive_assistant",
  руководитель: "manager",
  "руководитель проектов": "project_manager",
  сотрудник: "employee",
};

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = mulberry32(SEED);

function integer(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function pick(values) {
  return values[Math.floor(random() * values.length)];
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function weightedPick(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.value;
  }
  return entries.at(-1).value;
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function resolveInput(name) {
  const local = join(OUTPUT_DIR, name);
  const temporary = join(SOURCE_DIR, name);
  if (existsSync(local)) return local;
  if (existsSync(temporary)) return temporary;
  throw new Error(
    `Missing ${name}. Expected ${local} or reviewed source ${temporary}.`,
  );
}

function createTimestamps() {
  const timestamps = [START_AT + 9 * 60 * 60 * 1_000, END_AT - 3 * 60 * 60 * 1_000];

  while (timestamps.length < EVENT_COUNT) {
    let day = integer(0, 59);
    const weekday = new Date(START_AT + day * DAY_MS).getUTCDay();
    if ((weekday === 0 || weekday === 6) && random() < 0.78) {
      day = Math.max(0, day - (weekday === 0 ? 2 : 1));
    }

    const hour = random() < 0.94 ? integer(8, 19) : integer(0, 23);
    const minute = integer(0, 59);
    const second = integer(0, 59);
    timestamps.push(
      START_AT +
        day * DAY_MS +
        hour * 60 * 60 * 1_000 +
        minute * 60 * 1_000 +
        second * 1_000 +
        integer(0, 999),
    );
  }

  return timestamps.sort((left, right) => left - right);
}

function createRagIndexes() {
  return new Set(
    shuffle(Array.from({ length: EVENT_COUNT }, (_, index) => index)).slice(
      0,
      RAG_COUNT,
    ),
  );
}

function operationalPersona(variant) {
  if (!variant.is_unknown) {
    return {
      userRole: variant.user_role,
      department: variant.department,
    };
  }
  return pick(UNKNOWN_PERSONAS);
}

function userFor(agentName, persona) {
  const poolSize = agentName === "web_chat" ? 14 : 4;
  const prefix = agentName === "web_chat" ? "web" : "platform";
  const department = DEPARTMENT_CODES[persona.department] ?? "general";
  const role = ROLE_CODES[persona.userRole] ?? "employee";
  return `${prefix}_${department}_${role}_${String(integer(1, poolSize)).padStart(2, "0")}`;
}

function systemPrompt(agentName) {
  if (agentName === "agent_platform") {
    return [
      "Ты — корпоративный агент. Выполняй задачу через доступные инструменты,",
      "проверяй права доступа и фактический результат каждого действия.",
      "Не выдумывай данные недоступных систем. При неоднозначности запроси уточнение.",
      "Перед изменением записи найди её, после изменения проверь итоговый статус.",
    ].join(" ");
  }
  return [
    "Ты — корпоративный ИИ-помощник.",
    "Отвечай по-русски, кратко и не выдумывай недоступные данные.",
  ].join(" ");
}

function ragWrappedQuery(query, variant) {
  const systems = variant.expected_systems.length
    ? variant.expected_systems.join(", ")
    : "корпоративная база знаний";
  return [
    "<context>",
    "[Синтетические фрагменты корпоративного поиска]",
    `Доступные источники по текущему запросу: ${systems}.`,
    "Внутренний регламент: действия с записями должны подтверждаться результатом инструмента.",
    "Справочный фрагмент: при недостатке входных данных необходимо запросить уточнение.",
    "</context>",
    `<user_query>${query}</user_query>`,
  ].join("\n");
}

function repeatedQuery(query) {
  return `${pick([
    "Попробуй ещё раз, предыдущая попытка не завершилась.",
    "Повтори задачу: в прошлый раз получился не весь результат.",
    "Не сработало. Проверь доступ и выполни ещё раз.",
  ])}\n${query}`;
}

function requestMessages(agentName, variant, query, hasRag, isRepeat) {
  const messages = [{ role: "system", content: systemPrompt(agentName) }];

  if (variant.variant_type === "followup") {
    messages.push(
      {
        role: "user",
        content: "Выполни предыдущую корпоративную задачу по согласованным параметрам.",
      },
      {
        role: "assistant",
        content: "Основная часть задачи выполнена. Можно уточнить или изменить параметры.",
      },
    );
  }

  const finalQuery = isRepeat ? repeatedQuery(query) : query;
  messages.push({
    role: "user",
    content: hasRag ? ragWrappedQuery(finalQuery, variant) : finalQuery,
  });
  return messages;
}

function chooseOutcome(variant, agentName, isRepeat) {
  if (variant.is_unknown) {
    return weightedPick([
      { value: "unknown", weight: 76 },
      { value: "success", weight: 13 },
      { value: "partial", weight: 6 },
      { value: "error", weight: 5 },
    ]);
  }

  if (variant.variant_type === "problematic") {
    return weightedPick([
      { value: "success", weight: 9 },
      { value: "partial", weight: 36 },
      { value: "error", weight: 35 },
      { value: "unknown", weight: 20 },
    ]);
  }

  if (isRepeat) {
    return weightedPick([
      { value: "success", weight: 58 },
      { value: "partial", weight: 24 },
      { value: "error", weight: 14 },
      { value: "unknown", weight: 4 },
    ]);
  }

  const successWeight = agentName === "agent_platform" ? 67 : 77;
  return weightedPick([
    { value: "success", weight: successWeight },
    { value: "partial", weight: agentName === "agent_platform" ? 17 : 12 },
    { value: "error", weight: agentName === "agent_platform" ? 11 : 7 },
    { value: "unknown", weight: 5 },
  ]);
}

function toolCallsFor(variant, agentName, outcome, isRepeat) {
  if (outcome === "unknown") return [];

  const systems = variant.expected_systems.filter(
    (system) => TOOL_NAMES[system],
  );
  const fallbackSystems = systems.length ? systems : ["knowledge_base"];
  const difficultyBonus = variant.difficulty === "hard" ? 1 : 0;
  let count;

  if (agentName === "agent_platform") {
    count =
      2 +
      integer(0, 2) +
      Math.min(2, fallbackSystems.length - 1) +
      difficultyBonus;
  } else {
    count = random() < 0.18 ? 0 : 1 + integer(0, 1) + difficultyBonus;
  }

  if (outcome === "partial") count = Math.max(2, count + 1);
  if (outcome === "error") count = Math.max(1, count + 1);
  if (isRepeat) count += agentName === "agent_platform" ? 2 : 1;

  const calls = [];
  for (let index = 0; index < count; index += 1) {
    const system = fallbackSystems[index % fallbackSystems.length];
    const names = TOOL_NAMES[system];
    let status = "success";
    if (outcome === "error" && index === count - 1) status = "error";
    if (outcome === "partial" && index === count - 1) status = "error";
    calls.push({
      name: names[index % names.length],
      status,
      durationMs:
        integer(180, 2_400) *
        (status === "error" ? Number((1.25 + random() * 0.55).toFixed(2)) : 1),
    });
  }

  return calls.map((call) => ({
    ...call,
    durationMs: Math.round(call.durationMs),
  }));
}

function usageFor(messages, agentName, outcome, toolCalls, isRepeat) {
  const characters = messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  const inputBase = Math.ceil(characters / 2.7) + integer(45, 120);
  const platformFactor = agentName === "agent_platform" ? 2.35 : 1;
  const failureFactor =
    outcome === "error" ? 1.48 : outcome === "partial" ? 1.28 : 1;
  const repeatFactor = isRepeat ? 1.34 : 1;
  const toolFactor = 1 + toolCalls.length * 0.075;
  const inputTokens = Math.round(
    inputBase * platformFactor * failureFactor * repeatFactor * toolFactor,
  );

  const outputBase =
    agentName === "agent_platform" ? integer(280, 620) : integer(75, 230);
  const outputTokens = Math.round(
    outputBase *
      failureFactor *
      repeatFactor *
      (1 + toolCalls.length * 0.055),
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function feedbackFor(outcome) {
  const choices = {
    success: [
      { value: 1, weight: 36 },
      { value: 0, weight: 19 },
      { value: null, weight: 45 },
    ],
    partial: [
      { value: -1, weight: 20 },
      { value: 0, weight: 29 },
      { value: 1, weight: 5 },
      { value: null, weight: 46 },
    ],
    error: [
      { value: -1, weight: 34 },
      { value: 0, weight: 12 },
      { value: null, weight: 54 },
    ],
    unknown: [
      { value: -1, weight: 5 },
      { value: 0, weight: 14 },
      { value: null, weight: 81 },
    ],
  };
  return weightedPick(choices[outcome]);
}

function manualMinutesFor(variant) {
  if (variant.is_unknown) return { low: 0, base: 0, high: 0 };

  const scenarioBase = variant.scenario_ids.reduce(
    (sum, scenarioId) => sum + MANUAL_MINUTES[scenarioId],
    0,
  );
  const multiIntentFactor = variant.is_multi_intent ? 0.9 : 1;
  const variantFactor = {
    detailed: 1.15,
    long_context: 1.2,
    multi_system: 1.18,
    multi_intent: 1.12,
    problematic: 1.1,
    underspecified: 0.85,
    followup: 0.65,
  }[variant.variant_type] ?? 1;
  const base = Math.max(
    1,
    Math.round(scenarioBase * multiIntentFactor * variantFactor),
  );
  return {
    low: Math.max(1, Math.round(base * 0.65)),
    base,
    high: Math.max(base + 1, Math.round(base * 1.45)),
  };
}

function buildDataset(variants) {
  const timestamps = createTimestamps();
  const ragIndexes = createRagIndexes();
  const variantQueue = [];
  while (variantQueue.length < EVENT_COUNT) {
    variantQueue.push(...shuffle(variants));
  }

  let variantCursor = 0;
  const retryCandidates = [];
  const events = [];
  const goldLabels = [];

  for (let index = 0; index < EVENT_COUNT; index += 1) {
    const shouldRepeat =
      index >= variants.length &&
      retryCandidates.length > 0 &&
      random() < 0.145;
    const target = shouldRepeat
      ? pick(retryCandidates.slice(-Math.min(120, retryCandidates.length)))
      : null;
    const variant = target ? target.variant : variantQueue[variantCursor++];
    const agentName =
      target?.event.agentName ??
      (random() < 0.38 ? "agent_platform" : "web_chat");
    const persona = target
      ? {
          userRole: target.event.userRole,
          department: target.event.department,
        }
      : operationalPersona(variant);
    const userId =
      target?.event.userId ?? userFor(agentName, persona);
    const hasRag = ragIndexes.has(index);
    const messages = requestMessages(
      agentName,
      variant,
      variant.user_query,
      hasRag,
      Boolean(target),
    );
    const outcome = chooseOutcome(
      variant,
      agentName,
      Boolean(target),
    );
    const toolCalls = toolCallsFor(
      variant,
      agentName,
      outcome,
      Boolean(target),
    );
    const usage = usageFor(
      messages,
      agentName,
      outcome,
      toolCalls,
      Boolean(target),
    );
    const toolDuration = toolCalls.reduce(
      (sum, toolCall) => sum + toolCall.durationMs,
      0,
    );
    const id = `evt_${String(index + 1).padStart(6, "0")}`;
    const event = {
      id,
      createdAt: new Date(timestamps[index]).toISOString(),
      userId,
      userRole: persona.userRole,
      department: persona.department,
      agentName,
      request: {
        model:
          agentName === "agent_platform"
            ? "corporate-agent-local"
            : "corporate-assistant-local",
        messages,
      },
      usage,
      latencyMs: Math.round(
        toolDuration +
          usage.totalTokens * (agentName === "agent_platform" ? 2.7 : 2.1) +
          integer(220, 1_400),
      ),
      toolCalls,
      outcome,
      feedback: feedbackFor(outcome),
      ...(target ? { repeatOf: target.event.id } : {}),
    };

    events.push(event);
    goldLabels.push({
      id,
      scenarioIds: variant.scenario_ids,
      primaryAction: variant.primary_action,
      primaryDomain: variant.primary_domain,
      variantType: variant.variant_type,
      manualMinutes: manualMinutesFor(variant),
    });

    if (
      !variant.is_unknown &&
      (outcome === "error" || outcome === "partial")
    ) {
      retryCandidates.push({ event, variant });
    }
  }

  return { events, goldLabels };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validateSources(taxonomy, variants) {
  if (!Array.isArray(taxonomy.scenarios) || taxonomy.scenarios.length !== 16) {
    throw new Error("Taxonomy must contain 16 reviewed scenarios.");
  }
  if (variants.length !== 188) {
    throw new Error(`Expected 188 semantic variants, got ${variants.length}.`);
  }

  const scenarioIds = new Set(
    taxonomy.scenarios.map((scenario) => scenario.scenario_id),
  );
  const recordIds = new Set();
  for (const variant of variants) {
    if (recordIds.has(variant.record_id)) {
      throw new Error(`Duplicate semantic record id: ${variant.record_id}`);
    }
    recordIds.add(variant.record_id);
    for (const scenarioId of variant.scenario_ids) {
      if (!scenarioIds.has(scenarioId)) {
        throw new Error(
          `Unknown scenario ${scenarioId} in ${variant.record_id}.`,
        );
      }
    }
  }
}

function validateDataset(events, goldLabels, variants) {
  if (events.length !== EVENT_COUNT || goldLabels.length !== EVENT_COUNT) {
    throw new Error("Operational log and gold labels must contain 1,500 rows.");
  }

  const ids = new Set();
  const goldIds = new Set(goldLabels.map((label) => label.id));
  const referencedIds = new Set();
  let ragCount = 0;

  for (const event of events) {
    if (ids.has(event.id)) throw new Error(`Duplicate event id: ${event.id}`);
    ids.add(event.id);
    if (!goldIds.has(event.id)) {
      throw new Error(`Missing gold label for ${event.id}`);
    }
    if (
      event.usage.totalTokens !==
      event.usage.inputTokens + event.usage.outputTokens
    ) {
      throw new Error(`Invalid token total for ${event.id}`);
    }
    if (!["web_chat", "agent_platform"].includes(event.agentName)) {
      throw new Error(`Invalid agent name for ${event.id}`);
    }
    if (!["success", "partial", "error", "unknown"].includes(event.outcome)) {
      throw new Error(`Invalid outcome for ${event.id}`);
    }
    if (![null, -1, 0, 1].includes(event.feedback)) {
      throw new Error(`Invalid feedback for ${event.id}`);
    }
    if (
      event.request.messages.some((message) =>
        message.content.includes("<user_query>"),
      )
    ) {
      ragCount += 1;
    }
    if (event.repeatOf) {
      if (!ids.has(event.repeatOf)) {
        throw new Error(`repeatOf must reference an earlier event: ${event.id}`);
      }
      referencedIds.add(event.repeatOf);
    }
    if (
      event.outcome === "success" &&
      event.toolCalls.some((toolCall) => toolCall.status !== "success")
    ) {
      throw new Error(`Successful event has a failed tool: ${event.id}`);
    }
    if (
      event.outcome === "error" &&
      !event.toolCalls.some((toolCall) => toolCall.status === "error")
    ) {
      throw new Error(`Error event has no failed tool: ${event.id}`);
    }
  }

  if (ragCount !== RAG_COUNT) {
    throw new Error(`Expected ${RAG_COUNT} RAG records, got ${ragCount}.`);
  }

  const span =
    Date.parse(events.at(-1).createdAt) - Date.parse(events[0].createdAt);
  if (span < 59 * DAY_MS) {
    throw new Error("Operational timestamps do not cover the full 60 days.");
  }

  const coveredVariantShapes = new Set(
    goldLabels.map(
      (label) =>
        `${label.scenarioIds.join("+")}|${label.variantType}|${label.primaryAction}|${label.primaryDomain}`,
    ),
  );
  const expectedVariantShapes = new Set(
    variants.map(
      (variant) =>
        `${variant.scenario_ids.join("+")}|${variant.variant_type}|${variant.primary_action}|${variant.primary_domain}`,
    ),
  );
  for (const shape of expectedVariantShapes) {
    if (!coveredVariantShapes.has(shape)) {
      throw new Error(`Missing semantic variant shape: ${shape}`);
    }
  }

  const webEvents = events.filter((event) => event.agentName === "web_chat");
  const platformEvents = events.filter(
    (event) => event.agentName === "agent_platform",
  );
  const webUsers = new Set(webEvents.map((event) => event.userId)).size;
  const platformUsers = new Set(
    platformEvents.map((event) => event.userId),
  ).size;
  const webTokens = average(
    webEvents.map((event) => event.usage.totalTokens),
  );
  const platformTokens = average(
    platformEvents.map((event) => event.usage.totalTokens),
  );
  const webTools = average(webEvents.map((event) => event.toolCalls.length));
  const platformTools = average(
    platformEvents.map((event) => event.toolCalls.length),
  );

  if (platformUsers >= webUsers) {
    throw new Error("agent_platform must have fewer distinct users.");
  }
  if (platformTokens <= webTokens || platformTools <= webTools) {
    throw new Error(
      "agent_platform must use more tokens and tools on average.",
    );
  }

  const costly = events.filter(
    (event) => event.outcome === "error" || event.repeatOf,
  );
  const successful = events.filter(
    (event) => event.outcome === "success" && !event.repeatOf,
  );
  if (
    average(costly.map((event) => event.usage.totalTokens)) <=
    average(successful.map((event) => event.usage.totalTokens))
  ) {
    throw new Error("Failures/repeats must be costlier than clean successes.");
  }

  return {
    events: events.length,
    periodDays: 60,
    ragRecords: ragCount,
    repeatRecords: events.filter((event) => event.repeatOf).length,
    referencedRetryTargets: referencedIds.size,
    agentStats: {
      web_chat: {
        events: webEvents.length,
        users: webUsers,
        averageTokens: Math.round(webTokens),
        averageToolCalls: Number(webTools.toFixed(2)),
      },
      agent_platform: {
        events: platformEvents.length,
        users: platformUsers,
        averageTokens: Math.round(platformTokens),
        averageToolCalls: Number(platformTools.toFixed(2)),
      },
    },
    outcomeCounts: Object.fromEntries(
      ["success", "partial", "error", "unknown"].map((outcome) => [
        outcome,
        events.filter((event) => event.outcome === outcome).length,
      ]),
    ),
  };
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const taxonomy = JSON.parse(
    readFileSync(resolveInput("taxonomy.json"), "utf8"),
  );
  const variants = parseJsonLines(
    readFileSync(resolveInput("variants.jsonl"), "utf8"),
  );
  validateSources(taxonomy, variants);

  const { events, goldLabels } = buildDataset(variants);
  const report = validateDataset(events, goldLabels, variants);

  writeFileSync(
    join(OUTPUT_DIR, "taxonomy.json"),
    `${JSON.stringify(taxonomy, null, 2)}\n`,
  );
  writeFileSync(
    join(OUTPUT_DIR, "variants.jsonl"),
    `${variants.map((variant) => JSON.stringify(variant)).join("\n")}\n`,
  );
  writeFileSync(
    join(OUTPUT_DIR, "operational-log.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writeFileSync(
    join(OUTPUT_DIR, "gold-labels.json"),
    `${JSON.stringify(goldLabels)}\n`,
  );

  console.log(
    JSON.stringify(
      {
        seed: `0x${SEED.toString(16)}`,
        sourceVariants: variants.length,
        outputDirectory: OUTPUT_DIR,
        validation: "passed",
        ...report,
      },
      null,
      2,
    ),
  );
}

main();
