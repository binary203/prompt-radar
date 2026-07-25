import { describe, expect, it } from "vitest";
import { extractUserIntent } from "../../src/lib/analytics/intent";

describe("extractUserIntent", () => {
  it("extracts the real question from the provided RAG payload", () => {
    const sample = JSON.stringify({
      model: "local-model",
      messages: [
        {
          role: "user",
          content:
            "<context>Синтетический длинный документ.</context><user_query>а с госсистемой Честный знак какая интеграция и для чего?</user_query>",
        },
      ],
    });

    expect(extractUserIntent(sample)).toBe(
      "а с госсистемой Честный знак какая интеграция и для чего?",
    );
  });

  it("prefers the last explicit user_query", () => {
    const result = extractUserIntent({
      messages: [
        {
          role: "user",
          content:
            "<user_query>старый вопрос</user_query><user_query>актуальный вопрос</user_query>",
        },
      ],
    });

    expect(result).toBe("актуальный вопрос");
  });

  it("supports OpenAI content parts and strips context blocks", () => {
    const result = extractUserIntent({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "<context>очень длинный документ</context>" },
            { type: "text", text: "Вопрос пользователя: Найди карточку клиента" },
          ],
        },
      ],
    });

    expect(result).toBe("Найди карточку клиента");
  });
});
