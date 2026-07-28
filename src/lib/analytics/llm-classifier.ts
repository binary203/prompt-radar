import {
  createChatCompletion,
  type OpenAiCompatibleConfig,
} from "@/lib/providers/openai-compatible";

import type { ClassificationResult, TaxonomyScenario } from "./classifier";

/**
 * The last layer of the pipeline: everything cheaper has already declined to
 * answer, so the model sees only genuinely hard requests.
 *
 * The prompt is closed — the model picks an id from the taxonomy or says
 * UNKNOWN. It is never asked to invent a category, because a category no
 * scenario owns cannot be priced, and an unpriceable label is worse than an
 * honest gap.
 */

export interface LlmClassifier {
  readonly model: string;
  classify(intent: string): Promise<ClassificationResult>;
}

export type ChatCompletion = (
  messages: { role: "system" | "user"; content: string }[],
  config: OpenAiCompatibleConfig,
) => Promise<string>;

const UNKNOWN_ANSWER = "UNKNOWN";

export function createLlmClassifier(
  scenarios: readonly TaxonomyScenario[],
  config: OpenAiCompatibleConfig,
  chat: ChatCompletion = (messages, providerConfig) =>
    createChatCompletion(messages, providerConfig),
): LlmClassifier {
  const byId = new Map(
    scenarios.map((scenario) => [scenario.scenario_id, scenario]),
  );
  const catalogue = scenarios
    .map((scenario) => `${scenario.scenario_id} — ${scenario.title_ru}`)
    .join("\n");

  return {
    model: config.chatModel,
    async classify(intent) {
      const answer = await chat(
        [
          { role: "system", content: systemPrompt(catalogue) },
          { role: "user", content: intent },
        ],
        config,
      );
      const scenario = byId.get(parseScenarioId(answer, byId));

      if (!scenario) {
        return unknownResult();
      }

      const label = {
        scenarioId: scenario.scenario_id,
        action: scenario.action,
        domain: scenario.domain,
        // Fixed rather than self-reported: a model's stated confidence is not
        // evidence, and this layer only ever sees requests the cheap layers
        // already failed on.
        confidence: 0.7,
        matchedSignals: [`llm:${config.chatModel}`],
      };

      return {
        primary: label,
        labels: [label],
        actions: [label.action],
        domains: [label.domain],
        confidence: label.confidence,
        isUnknown: false,
      };
    },
  };
}

function systemPrompt(catalogue: string): string {
  return [
    "Ты классифицируешь запросы сотрудников к корпоративному ИИ-агенту.",
    "Выбери ровно один сценарий из списка ниже.",
    `Если ни один не подходит, ответь ${UNKNOWN_ANSWER}.`,
    "В ответе — только идентификатор сценария, без пояснений.",
    "",
    "Сценарии:",
    catalogue,
  ].join("\n");
}

/**
 * Models pad answers with quotes, backticks and explanations no matter how the
 * prompt is worded, so the id is looked up inside the response rather than
 * matched against it.
 */
function parseScenarioId(
  answer: string,
  byId: ReadonlyMap<string, TaxonomyScenario>,
): string {
  const normalized = answer.trim().toLowerCase();

  if (normalized.includes(UNKNOWN_ANSWER.toLowerCase())) {
    return "";
  }

  for (const scenarioId of byId.keys()) {
    if (normalized.includes(scenarioId.toLowerCase())) {
      return scenarioId;
    }
  }

  return "";
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
