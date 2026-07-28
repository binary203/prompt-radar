import { describe, expect, it } from "vitest";

import type { TaxonomyScenario } from "../../src/lib/analytics/classifier";
import { createHashingEmbedder } from "../../src/lib/analytics/embedding";
import { createVectorClassifier } from "../../src/lib/analytics/vector-classifier";

const SCENARIOS: TaxonomyScenario[] = [
  {
    scenario_id: "email_digest",
    title_ru: "Сводка за день по почте",
    description_ru: "Собрать входящие письма за день и выделить главное",
    action: "summarize",
    domain: "email",
    manual_work_steps: ["открыть почту", "прочитать входящие письма"],
  },
  {
    scenario_id: "meeting_slot",
    title_ru: "Подбор слота для встречи",
    description_ru: "Найти общее время участников и назначить переговоры",
    action: "schedule",
    domain: "calendar_meetings",
    manual_work_steps: ["свериться с календарями", "назначить встречу"],
  },
];

const embedder = createHashingEmbedder();

describe("createVectorClassifier", () => {
  it("matches the nearest prototype once the threshold is cleared", async () => {
    const classifier = await createVectorClassifier(SCENARIOS, embedder, 0);
    const [vector] = await embedder.embed([
      "собрать входящие письма за день и выделить главное",
    ]);

    expect(classifier.classify(vector).primary?.scenarioId).toBe(
      "email_digest",
    );
  });

  it("stays UNKNOWN rather than guessing below the threshold", async () => {
    const classifier = await createVectorClassifier(SCENARIOS, embedder, 0.9);
    const [vector] = await embedder.embed(["сколько стоит картошка"]);

    expect(classifier.classify(vector).isUnknown).toBe(true);
    // The nearest prototype still exists — the layer just refuses to use it.
    expect(classifier.match(vector)?.similarity).toBeLessThan(0.9);
  });
});
