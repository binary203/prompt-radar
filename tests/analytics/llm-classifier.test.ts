import { describe, expect, it, vi } from "vitest";

import type { TaxonomyScenario } from "../../src/lib/analytics/classifier";
import { createLlmClassifier } from "../../src/lib/analytics/llm-classifier";
import type { OpenAiCompatibleConfig } from "../../src/lib/providers/openai-compatible";

const SCENARIOS: TaxonomyScenario[] = [
  {
    scenario_id: "email_digest",
    title_ru: "Сводка за день по почте",
    action: "summarize",
    domain: "email",
  },
  {
    scenario_id: "meeting_slot",
    title_ru: "Подбор слота для встречи",
    action: "schedule",
    domain: "calendar_meetings",
  },
];

const CONFIG: OpenAiCompatibleConfig = {
  baseUrl: "https://provider.example/v1",
  chatModel: "corporate-assistant",
};

describe("createLlmClassifier", () => {
  it("offers only taxonomy ids and resolves the one the model picks", async () => {
    const chat = vi.fn().mockResolvedValue("`email_digest`");
    const classifier = createLlmClassifier(SCENARIOS, CONFIG, chat);

    const result = await classifier.classify("что там по почте за сегодня");

    expect(result.primary?.scenarioId).toBe("email_digest");
    expect(result.primary?.domain).toBe("email");
    expect(result.isUnknown).toBe(false);

    const systemPrompt = chat.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain("email_digest");
    expect(systemPrompt).toContain("meeting_slot");
    expect(systemPrompt).toContain("UNKNOWN");
  });

  it("stays UNKNOWN when the model declines", async () => {
    const classifier = createLlmClassifier(
      SCENARIOS,
      CONFIG,
      vi.fn().mockResolvedValue("UNKNOWN"),
    );

    expect((await classifier.classify("привет")).isUnknown).toBe(true);
  });

  it("does not accept a category the taxonomy has no id for", async () => {
    const classifier = createLlmClassifier(
      SCENARIOS,
      CONFIG,
      vi.fn().mockResolvedValue("invoice_processing"),
    );

    expect((await classifier.classify("проведи счёт")).isUnknown).toBe(true);
  });
});
