import {
  createChatCompletion,
  getOpenAiCompatibleConfig,
} from "../../src/lib/providers/openai-compatible";
import { describe, expect, it, vi } from "vitest";

describe("OpenAI-compatible provider", () => {
  it("uses the standard chat completions endpoint", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "  готово  " } }],
      }),
    );

    const result = await createChatCompletion(
      [{ role: "user", content: "Проверь запрос" }],
      {
        baseUrl: "http://local-llm.example/v1",
        apiKey: "secret",
        chatModel: "local-model",
      },
      fetcher,
    );

    expect(result).toBe("готово");
    expect(fetcher).toHaveBeenCalledWith(
      "http://local-llm.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("stays disabled when required environment values are missing", () => {
    expect(getOpenAiCompatibleConfig({})).toBeNull();
  });
});
