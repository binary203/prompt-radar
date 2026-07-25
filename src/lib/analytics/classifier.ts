import type {
  ActionTag,
  BusinessDomain,
} from "../contracts/analysis";

export interface TaxonomyScenario {
  scenario_id: string;
  title_ru: string;
  description_ru?: string;
  action: ActionTag;
  domain: BusinessDomain;
  systems?: readonly string[];
  manual_work_steps?: readonly string[];
  /** Expert estimate of doing this scenario by hand, in minutes. */
  manual_minutes?: {
    low: number;
    base: number;
    high: number;
  };
}

export interface Taxonomy {
  scenarios: readonly TaxonomyScenario[];
}

export interface ClassificationLabel {
  scenarioId: string;
  action: ActionTag;
  domain: BusinessDomain;
  confidence: number;
  matchedSignals: string[];
}

export interface ClassificationResult {
  primary: ClassificationLabel | null;
  labels: ClassificationLabel[];
  actions: ActionTag[];
  domains: BusinessDomain[];
  confidence: number;
  isUnknown: boolean;
}

interface ScoredScenario {
  scenario: TaxonomyScenario;
  rawScore: number;
  actionMatches: string[];
  domainMatches: string[];
  taxonomyMatches: string[];
}

const STOP_WORDS = new Set([
  "без",
  "был",
  "быть",
  "вам",
  "ваш",
  "весь",
  "для",
  "его",
  "еще",
  "или",
  "как",
  "какая",
  "какой",
  "которые",
  "мне",
  "мои",
  "мой",
  "надо",
  "наш",
  "она",
  "они",
  "при",
  "про",
  "свой",
  "так",
  "там",
  "что",
  "это",
  "the",
  "and",
  "for",
  "from",
  "with",
]);

const ACTION_SIGNALS: Record<ActionTag, readonly string[]> = {
  retrieve: ["найд", "покаж", "получ", "список", "поиск", "извлек", "дай"],
  summarize: ["сводк", "саммар", "резюм", "кратк", "итог"],
  analyze: ["анализ", "проанализ", "оцен", "сравн", "исслед"],
  write: ["напиш", "состав", "подготов", "черновик", "ответ", "отзыв"],
  create: ["созда", "завед", "добав", "зафикс", "постав"],
  update: ["обнов", "измен", "закр", "отмет", "актуализ"],
  export: ["выгруз", "экспорт", "excel", "xlsx", "таблиц"],
  schedule: ["заплан", "назнач", "слот", "переговор", "календар", "встреч"],
  monitor: ["монитор", "проверя", "отслеж", "контрол", "регуляр", "просроч"],
  notify: ["уведом", "сообщ", "оповест", "эскалир", "напомн"],
  other: [],
};

const DOMAIN_SIGNALS: Record<BusinessDomain, readonly string[]> = {
  email: ["почт", "письм", "входящ", "переписк", "email"],
  crm_sales: [
    "crm",
    "клиент",
    "сделк",
    "продаж",
    "тендер",
    "вендор",
    "компан",
  ],
  project_systems: [
    "тикет",
    "задач",
    "проект",
    "исуп",
    "доск",
    "статус",
    "трекер",
  ],
  hr: ["сотрудник", "отзыв", "руководител", "hr", "персонал", "наблюден"],
  calendar_meetings: [
    "календар",
    "встреч",
    "переговор",
    "слот",
    "участник",
    "расписан",
  ],
  knowledge_base: [
    "confluence",
    "блог",
    "знан",
    "документ",
    "регламент",
    "поставщик",
    "база",
  ],
  spreadsheets_analytics: [
    "excel",
    "xlsx",
    "таблиц",
    "выгруз",
    "отчет",
    "аналитик",
  ],
  public_sources: [
    "открыт",
    "рынок",
    "публикац",
    "новост",
    "интернет",
    "источник",
  ],
  other: [],
};

const CLAUSE_SEPARATOR =
  /\s*(?:[;.!?]+|\bа\s+затем\b|\bпосле\s+этого\b|\bи\s+ещ[её]\b|\bтакже\b|\bплюс\b|\s+и\s+)\s*/giu;

const taxonomyTokenCache = new WeakMap<
  TaxonomyScenario,
  Set<string>
>();

/**
 * A deterministic, explainable baseline. It intentionally returns UNKNOWN
 * when the taxonomy has no strong lexical/action/domain evidence.
 */
export function classifyIntent(
  text: string,
  taxonomy: Taxonomy | readonly TaxonomyScenario[],
): ClassificationResult {
  const scenarios = isTaxonomy(taxonomy) ? taxonomy.scenarios : taxonomy;
  const normalized = normalize(text);

  if (!normalized || scenarios.length === 0) {
    return unknownResult();
  }

  const wholeTextCandidates = scoreText(normalized, scenarios);
  const candidates = [...wholeTextCandidates];
  const clauses = normalized
    .split(CLAUSE_SEPARATOR)
    .map((clause) => clause.trim())
    .filter((clause) => tokenize(clause).length >= 2);
  const clauseBestMatches =
    clauses.length > 1
      ? clauses
          .map((clause) => scoreText(clause, scenarios)[0])
          .filter((candidate): candidate is ScoredScenario =>
            Boolean(candidate),
          )
      : [];

  for (const bestClauseMatch of clauseBestMatches) {
    if (isStrongMatch(bestClauseMatch)) {
      candidates.push(bestClauseMatch);
    }
  }

  const uniqueCandidates = deduplicateScores(candidates);
  const best = uniqueCandidates[0];

  if (!best || !isStrongMatch(best)) {
    return unknownResult();
  }

  const strongClauseScenarioIds = new Set(
    clauseBestMatches
      .filter(isStrongMatch)
      .map((candidate) => candidate.scenario.scenario_id),
  );
  const selected = uniqueCandidates
    .filter((candidate, index) => {
      if (index === 0) {
        return true;
      }
      const hasIndependentClause = strongClauseScenarioIds.has(
        candidate.scenario.scenario_id,
      );
      return hasIndependentClause && candidate.rawScore >= best.rawScore * 0.55;
    })
    .slice(0, 3)
    .map(toLabel);

  const primary = selected[0] ?? null;

  return {
    primary,
    labels: selected,
    actions: unique(selected.map((label) => label.action)),
    domains: unique(selected.map((label) => label.domain)),
    confidence: primary?.confidence ?? 0,
    isUnknown: false,
  };
}

function scoreText(
  text: string,
  scenarios: readonly TaxonomyScenario[],
): ScoredScenario[] {
  const tokens = tokenize(text);

  return scenarios
    .map((scenario) => {
      const actionMatches = matchSignals(text, ACTION_SIGNALS[scenario.action]);
      const domainMatches = matchSignals(text, DOMAIN_SIGNALS[scenario.domain]);
      const profileTokens = taxonomyTokens(scenario);
      const taxonomyMatches = unique(
        tokens.filter((token) => profileTokens.has(root(token))),
      );

      return {
        scenario,
        rawScore:
          actionMatches.length * 2.1 +
          domainMatches.length * 1.7 +
          taxonomyMatches.length * 0.75,
        actionMatches,
        domainMatches,
        taxonomyMatches,
      };
    })
    .sort(
      (left, right) =>
        right.rawScore - left.rawScore ||
        left.scenario.scenario_id.localeCompare(right.scenario.scenario_id),
    );
}

function taxonomyTokens(scenario: TaxonomyScenario): Set<string> {
  const cached = taxonomyTokenCache.get(scenario);
  if (cached) {
    return cached;
  }

  const source = [
    scenario.title_ru,
    scenario.description_ru ?? "",
    ...(scenario.manual_work_steps ?? []),
  ].join(" ");

  const tokens = new Set(tokenize(source).map(root));
  taxonomyTokenCache.set(scenario, tokens);
  return tokens;
}

function matchSignals(text: string, signals: readonly string[]): string[] {
  return signals.filter((signal) => text.includes(signal));
}

function isStrongMatch(candidate: ScoredScenario): boolean {
  const hasStructuredEvidence =
    candidate.actionMatches.length > 0 && candidate.domainMatches.length > 0;
  const hasTaxonomyEvidence = candidate.taxonomyMatches.length >= 2;

  return (
    candidate.rawScore >= 3.2 &&
    (hasStructuredEvidence || hasTaxonomyEvidence)
  );
}

function toLabel(candidate: ScoredScenario): ClassificationLabel {
  const confidence = clamp(
    0.3 + (candidate.rawScore / (candidate.rawScore + 5)) * 0.68,
    0,
    0.98,
  );

  return {
    scenarioId: candidate.scenario.scenario_id,
    action: candidate.scenario.action,
    domain: candidate.scenario.domain,
    confidence: round(confidence, 4),
    matchedSignals: unique([
      ...candidate.actionMatches,
      ...candidate.domainMatches,
      ...candidate.taxonomyMatches,
    ]),
  };
}

function deduplicateScores(candidates: readonly ScoredScenario[]) {
  const byScenario = new Map<string, ScoredScenario>();

  for (const candidate of candidates) {
    const current = byScenario.get(candidate.scenario.scenario_id);
    if (!current || candidate.rawScore > current.rawScore) {
      byScenario.set(candidate.scenario.scenario_id, candidate);
    }
  }

  return [...byScenario.values()].sort(
    (left, right) =>
      right.rawScore - left.rawScore ||
      left.scenario.scenario_id.localeCompare(right.scenario.scenario_id),
  );
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").trim();
}

function root(token: string): string {
  return token.length > 7 ? token.slice(0, 7) : token;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
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

function isTaxonomy(
  value: Taxonomy | readonly TaxonomyScenario[],
): value is Taxonomy {
  return !Array.isArray(value);
}
