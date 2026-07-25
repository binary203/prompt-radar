import type { OpenAiRequest } from "@/lib/contracts/operational";

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export function getOpenAiCompatibleConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OpenAiCompatibleConfig | null {
  const baseUrl = env.AI_BASE_URL?.trim();
  const chatModel = env.AI_CHAT_MODEL?.trim();

  if (!baseUrl || !chatModel) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: env.AI_API_KEY?.trim() || undefined,
    chatModel,
  };
}

export async function createChatCompletion(
  messages: OpenAiRequest["messages"],
  config: OpenAiCompatibleConfig,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey
        ? { authorization: `Bearer ${config.apiKey}` }
        : undefined),
    },
    body: JSON.stringify({
      model: config.chatModel,
      messages,
      stream: false,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI provider returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("AI provider returned an empty completion");
  }

  return content;
}
