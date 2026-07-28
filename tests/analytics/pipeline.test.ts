import { describe, expect, it, vi } from "vitest";

import type { Taxonomy } from "../../src/lib/analytics/classifier";
import type { LlmClassifier } from "../../src/lib/analytics/llm-classifier";
import {
  runPipeline,
  type PipelineRequest,
} from "../../src/lib/analytics/pipeline";

const TAXONOMY: Taxonomy = {
  scenarios: [
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
  ],
};

function ask(id: string, content: string): PipelineRequest {
  return {
    id,
    request: {
      model: "corporate-assistant",
      messages: [
        { role: "system", content: "Ты — корпоративный ИИ-помощник." },
        { role: "user", content },
      ],
    },
  };
}

const TOKEN_COST_PER_MILLION = 139;

describe("runPipeline", () => {
  it("answers with the cheapest layer that can and never calls a later one", async () => {
    const llm: LlmClassifier = {
      model: "test",
      classify: vi.fn().mockResolvedValue({
        primary: null,
        labels: [],
        actions: [],
        domains: [],
        confidence: 0,
        isUnknown: true,
      }),
    };

    const report = await runPipeline(
      [ask("a", "сделай сводку по входящей почте за день")],
      { taxonomy: TAXONOMY, llm, tokenCostPerMillion: TOKEN_COST_PER_MILLION },
    );

    expect(report.decisions[0].resolvedBy).toBe("rules");
    expect(report.decisions[0].classification.primary?.scenarioId).toBe(
      "email_digest",
    );
    expect(llm.classify).not.toHaveBeenCalled();
  });

  it("serves a repeated intent from the cache instead of classifying twice", async () => {
    const report = await runPipeline(
      [
        ask("a", "сделай сводку по входящей почте за день"),
        ask("b", "Сделай  сводку по входящей почте за день!"),
      ],
      { taxonomy: TAXONOMY, tokenCostPerMillion: TOKEN_COST_PER_MILLION },
    );

    expect(report.cache.uniqueIntents).toBe(1);
    expect(report.decisions.map((decision) => decision.resolvedBy)).toEqual([
      "rules",
      "cache",
    ]);
    expect(report.cache.hitRate).toBe(0.5);
  });

  it("sends only what nothing cheaper recognised to the model", async () => {
    const classify = vi.fn().mockResolvedValue({
      primary: {
        scenarioId: "meeting_slot",
        action: "schedule",
        domain: "calendar_meetings",
        confidence: 0.7,
        matchedSignals: ["llm:test"],
      },
      labels: [],
      actions: [],
      domains: [],
      confidence: 0.7,
      isUnknown: false,
    });

    const report = await runPipeline(
      [
        ask("a", "сделай сводку по входящей почте за день"),
        ask("b", "когда там у нас с ними получится пересечься"),
      ],
      {
        taxonomy: TAXONOMY,
        llm: { model: "test", classify },
        tokenCostPerMillion: TOKEN_COST_PER_MILLION,
      },
    );

    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith(
      "когда там у нас с ними получится пересечься",
    );
    expect(report.costs.actualRub).toBeLessThan(
      report.costs.everythingToLlmRub,
    );
  });

  it("stops calling the model once the budget is spent", async () => {
    const classify = vi.fn().mockResolvedValue({
      primary: null,
      labels: [],
      actions: [],
      domains: [],
      confidence: 0,
      isUnknown: true,
    });

    const report = await runPipeline(
      [
        ask("a", "когда там у нас с ними получится пересечься"),
        ask("b", "а по тому вопросу что вчера обсуждали как"),
      ],
      {
        taxonomy: TAXONOMY,
        llm: { model: "test", classify },
        llmCallBudget: 1,
        tokenCostPerMillion: TOKEN_COST_PER_MILLION,
      },
    );

    expect(classify).toHaveBeenCalledTimes(1);
    expect(report.llm.deferred).toBeGreaterThan(0);
  });

  it("keeps the report intact when the provider fails", async () => {
    const report = await runPipeline(
      [ask("a", "когда там у нас с ними получится пересечься")],
      {
        taxonomy: TAXONOMY,
        llm: {
          model: "test",
          classify: vi.fn().mockRejectedValue(new Error("HTTP 503")),
        },
        tokenCostPerMillion: TOKEN_COST_PER_MILLION,
      },
    );

    expect(report.decisions[0].resolvedBy).toBe("unresolved");
    expect(report.unresolved).toBe(1);
  });

  it("counts extraction against the whole payload, not the question", async () => {
    const report = await runPipeline(
      [ask("a", "сделай сводку по входящей почте за день")],
      { taxonomy: TAXONOMY, tokenCostPerMillion: TOKEN_COST_PER_MILLION },
    );

    expect(report.extraction.sourceChars).toBeGreaterThan(
      report.extraction.intentChars,
    );
    expect(report.extraction.compressionRatio).toBeGreaterThan(1);
  });
});
