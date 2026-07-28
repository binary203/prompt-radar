import taxonomyData from "@/data/synthetic/taxonomy.json";
import { createLlmClassifier, type Taxonomy } from "@/lib/analytics";
import { getOpenAiCompatibleConfig } from "@/lib/providers/openai-compatible";

export const runtime = "nodejs";

/**
 * The last pipeline layer, exposed to the browser.
 *
 * The dashboard analyses an uploaded log entirely client-side, which is the
 * point — the log never leaves the machine. The model layer is the one step
 * that cannot work there, because the provider key must never reach a browser.
 * So the browser sends intents, this route sends back labels, and the key stays
 * on the server.
 *
 * Intents are short questions already stripped of their RAG context by the
 * extraction layer, so this forwards a question, not a document.
 */

/** A browser could otherwise ask for a thousand completions in one request. */
const MAX_INTENTS_PER_REQUEST = 25;
const MAX_INTENT_LENGTH = 2_000;

export async function POST(request: Request) {
  const config = getOpenAiCompatibleConfig();

  if (!config) {
    return Response.json(
      { error: "Провайдер модели не настроен на сервере." },
      { status: 503 },
    );
  }

  let intents: unknown;

  try {
    ({ intents } = (await request.json()) as { intents?: unknown });
  } catch {
    return Response.json({ error: "Ожидался JSON." }, { status: 400 });
  }

  if (!Array.isArray(intents)) {
    return Response.json(
      { error: "Ожидалось поле intents со списком строк." },
      { status: 400 },
    );
  }

  const cleaned = intents
    .filter((intent): intent is string => typeof intent === "string")
    .map((intent) => intent.trim().slice(0, MAX_INTENT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_INTENTS_PER_REQUEST);

  const taxonomy = taxonomyData as Taxonomy;
  const classifier = createLlmClassifier(taxonomy.scenarios, config);

  const results = await Promise.all(
    cleaned.map(async (intent) => {
      try {
        const classification = await classifier.classify(intent);
        return { intent, classification };
      } catch {
        // One failed completion must not fail the batch: the caller treats a
        // null classification as UNKNOWN, which is what it is.
        return { intent, classification: null };
      }
    }),
  );

  return Response.json({ model: config.chatModel, results });
}
