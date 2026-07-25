import { describe, expect, it } from "vitest";
import {
  classifyIntent,
  type Taxonomy,
} from "../../src/lib/analytics/classifier";

const taxonomy: Taxonomy = {
  scenarios: [
    {
      scenario_id: "email_digest",
      title_ru: "Сводка за день по почте",
      description_ru: "Собрать письма и подготовить краткую сводку.",
      action: "summarize",
      domain: "email",
      systems: ["email"],
    },
    {
      scenario_id: "client_correspondence",
      title_ru: "Ответ клиенту на письмо",
      description_ru: "Прочитать переписку и составить ответ клиенту.",
      action: "write",
      domain: "email",
      systems: ["email", "crm"],
    },
    {
      scenario_id: "calendar_scheduling",
      title_ru: "Планирование встреч и переговорных",
      description_ru:
        "Найти свободный слот в календаре и создать встречу.",
      action: "schedule",
      domain: "calendar_meetings",
      systems: ["calendar"],
    },
  ],
};

describe("classifyIntent", () => {
  it("classifies a strong taxonomy match", () => {
    const result = classifyIntent(
      "Собери письма за сегодня и сделай краткую сводку",
      taxonomy,
    );

    expect(result.isUnknown).toBe(false);
    expect(result.primary?.scenarioId).toBe("email_digest");
    expect(result.primary?.action).toBe("summarize");
    expect(result.primary?.domain).toBe("email");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("supports obvious multi-intent requests", () => {
    const result = classifyIntent(
      "Составь ответ клиенту на письмо и затем найди слот в календаре для встречи",
      taxonomy,
    );

    expect(result.labels.map((label) => label.scenarioId)).toEqual(
      expect.arrayContaining(["client_correspondence", "calendar_scheduling"]),
    );
  });

  it("returns UNKNOWN without taxonomy evidence", () => {
    const result = classifyIntent("Привет, как дела?", taxonomy);

    expect(result).toMatchObject({
      isUnknown: true,
      confidence: 0,
      labels: [],
      primary: null,
    });
  });
});
