import { readFile } from "node:fs/promises";
import path from "node:path";

import ragPayloadSample from "@/data/synthetic/rag-payload-sample.json";
import taxonomyData from "@/data/synthetic/taxonomy.json";
import {
  buildCheckpoint,
  createLlmClassifier,
  type Checkpoint,
  type GoldLabel,
  type RagSample,
  type Taxonomy,
} from "@/lib/analytics";
import {
  operationalEventSchema,
  type OperationalEvent,
} from "@/lib/contracts/operational";
import { getOpenAiCompatibleConfig } from "@/lib/providers/openai-compatible";

export const runtime = "nodejs";

let cachedCheckpoint: Promise<Checkpoint> | null = null;

export async function GET() {
  cachedCheckpoint ??= buildDemoCheckpoint();

  try {
    return Response.json(await cachedCheckpoint);
  } catch (error) {
    cachedCheckpoint = null;
    throw error;
  }
}

async function buildDemoCheckpoint(): Promise<Checkpoint> {
  const [events, goldLabels] = await Promise.all([
    loadOperationalEvents(),
    loadGoldLabels(),
  ]);
  const taxonomy = taxonomyData as Taxonomy;

  return buildCheckpoint({
    events,
    goldLabels,
    taxonomy,
    ragSample: ragPayloadSample as RagSample,
    llm: buildLlmClassifier(taxonomy),
    sourceLabel: "Демо-датасет",
  });
}

/**
 * The model layer only exists when the deployment configured a provider. With
 * no key the pipeline still runs end to end and reports how much traffic would
 * have reached the model — the number stays honest either way.
 */
function buildLlmClassifier(taxonomy: Taxonomy) {
  const config = getOpenAiCompatibleConfig();

  return config ? createLlmClassifier(taxonomy.scenarios, config) : null;
}

async function loadOperationalEvents(): Promise<OperationalEvent[]> {
  const raw = await readFile(
    path.join(process.cwd(), "src/data/synthetic/operational-log.jsonl"),
    "utf8",
  );

  return raw
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => operationalEventSchema.parse(JSON.parse(line)));
}

async function loadGoldLabels(): Promise<GoldLabel[]> {
  const raw = await readFile(
    path.join(process.cwd(), "src/data/synthetic/gold-labels.json"),
    "utf8",
  );

  return JSON.parse(raw) as GoldLabel[];
}
