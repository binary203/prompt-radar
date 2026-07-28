import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

/**
 * A short slice of the demo log, so someone who wants to try the upload has a
 * correctly shaped file to start from without downloading two megabytes.
 */
const SAMPLE_EVENTS = 50;

export async function GET() {
  const raw = await readFile(
    path.join(process.cwd(), "src/data/synthetic/operational-log.jsonl"),
    "utf8",
  );
  const sample = raw
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(0, SAMPLE_EVENTS)
    .join("\n");

  return new Response(`${sample}\n`, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition":
        'attachment; filename="prompt-radar-sample.jsonl"',
    },
  });
}
