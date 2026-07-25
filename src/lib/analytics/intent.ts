export interface OpenAICompatibleMessage {
  role?: string;
  content?: unknown;
}

export interface OpenAICompatiblePayload {
  messages?: readonly OpenAICompatibleMessage[];
}

const USER_QUERY_PATTERN =
  /<user_query(?:\s[^>]*)?>([\s\S]*?)<\/user_query\s*>/giu;

const CONTEXT_BLOCK_PATTERNS = [
  /<context(?:\s[^>]*)?>[\s\S]*?<\/context\s*>/giu,
  /<source(?:\s[^>]*)?>[\s\S]*?<\/source\s*>/giu,
  /<documents?(?:\s[^>]*)?>[\s\S]*?<\/documents?\s*>/giu,
  /<retrieved_context(?:\s[^>]*)?>[\s\S]*?<\/retrieved_context\s*>/giu,
] as const;

const QUERY_MARKER_PATTERN =
  /(?:^|\n)\s*(?:user\s*(?:query|question)|query|question|запрос\s+пользователя|вопрос\s+пользователя|вопрос)\s*:\s*/giu;

const WRAPPER_LINE_PATTERNS = [
  /^(?:используй|используйте)\s+(?:следующий|предоставленный)\s+контекст\b/iu,
  /^(?:ответь|ответьте)\s+на\s+(?:вопрос|запрос)\b/iu,
  /^use\s+the\s+(?:following|provided)\s+context\b/iu,
  /^answer\s+the\s+(?:user'?s?\s+)?(?:question|query)\b/iu,
  /^(?:контекст|context|источники?|sources?)\s*:?\s*$/iu,
] as const;

/**
 * Extracts the user's actual intent from an OpenAI-compatible request.
 *
 * RAG gateways commonly put an entire source document and a short question in
 * the same `user` message. An explicit, last `<user_query>` is authoritative;
 * only then do we fall back to cleaning wrapper/context blocks.
 */
export function extractUserIntent(
  input:
    | OpenAICompatiblePayload
    | readonly OpenAICompatibleMessage[]
    | string
    | unknown,
): string {
  const messages = getMessages(input);
  const userContents = messages
    .filter((message) => message.role?.toLowerCase() === "user")
    .map((message) => contentToText(message.content))
    .filter(Boolean);

  for (let index = userContents.length - 1; index >= 0; index -= 1) {
    const taggedQuery = getLastTaggedQuery(userContents[index]);
    if (taggedQuery) {
      return taggedQuery;
    }
  }

  for (let index = userContents.length - 1; index >= 0; index -= 1) {
    const cleaned = cleanWrappedContent(userContents[index]);
    if (isMeaningful(cleaned)) {
      return cleaned;
    }
  }

  return "";
}

function getMessages(
  input:
    | OpenAICompatiblePayload
    | readonly OpenAICompatibleMessage[]
    | string
    | unknown,
): readonly OpenAICompatibleMessage[] {
  if (Array.isArray(input)) {
    return input.filter(isMessage);
  }

  if (typeof input === "string") {
    try {
      return getMessages(JSON.parse(input) as unknown);
    } catch {
      return [{ role: "user", content: input }];
    }
  }

  if (
    input !== null &&
    typeof input === "object" &&
    "messages" in input &&
    Array.isArray(input.messages)
  ) {
    return input.messages.filter(isMessage);
  }

  return [];
}

function isMessage(value: unknown): value is OpenAICompatibleMessage {
  return value !== null && typeof value === "object";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          part !== null &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (
    content !== null &&
    typeof content === "object" &&
    "text" in content &&
    typeof content.text === "string"
  ) {
    return content.text;
  }

  return "";
}

function getLastTaggedQuery(content: string): string {
  const matches = Array.from(content.matchAll(USER_QUERY_PATTERN));

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const query = normalizeText(stripTags(matches[index][1]));
    if (isMeaningful(query)) {
      return query;
    }
  }

  return "";
}

function cleanWrappedContent(content: string): string {
  let cleaned = content;

  for (const pattern of CONTEXT_BLOCK_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  const markerMatches = Array.from(cleaned.matchAll(QUERY_MARKER_PATTERN));
  if (markerMatches.length > 0) {
    const lastMarker = markerMatches.at(-1);
    if (lastMarker?.index !== undefined) {
      cleaned = cleaned.slice(lastMarker.index + lastMarker[0].length);
    }
  }

  cleaned = stripTags(cleaned);
  cleaned = cleaned
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !WRAPPER_LINE_PATTERNS.some((pattern) => pattern.test(line)),
    )
    .join(" ");

  return normalizeText(cleaned);
}

function stripTags(value: string): string {
  return value.replace(/<\/?[\w:-]+(?:\s[^>]*)?>/gu, " ");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isMeaningful(value: string): boolean {
  return /[\p{L}\p{N}]{2,}/u.test(value);
}
