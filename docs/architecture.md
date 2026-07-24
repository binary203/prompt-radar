# Architecture

## Constraints

- The average source prompt may be close to 100k tokens.
- Vercel Functions accept request/response payloads up to 4.5 MB.
- The deployed function bundle must stay on the standard lightweight path.
- The hackathon prototype must work without a database or GPU.
- The result must be reproducible and explainable to the jury.

## Data flow

```text
CSV in browser
  -> streaming parse
  -> normalization and exact deduplication
  -> Intent Capsule extraction
  -> short embedding batches through /api/embed
  -> action/domain prototype classification
  -> low-confidence UNKNOWN bucket
  -> scenario clustering inside action/domain
  -> one summary call per cluster
  -> trends, problems, automation opportunities
  -> AnalysisResult
  -> dashboard and Markdown/JSON export
```

The browser keeps the full source text. Server routes receive only the minimal
text needed for an embedding or a cluster summary.

## MVP boundaries

The MVP is a single Next.js application. It has no persistent multi-user state.
Analysis state can live in memory or IndexedDB and can be exported. Persistence,
Vercel Blob, OpenTelemetry ingestion and a corporate AI gateway adapter are
post-MVP integrations.

## Evaluation

The synthetic generator keeps hidden expected labels. The analyzer never reads
them during prediction. The methodology page compares:

1. lexical baseline;
2. embedding prototypes;
3. embedding prototypes plus UNKNOWN threshold;
4. full classification and scenario clustering cascade.

Report Macro-F1, cluster purity, UNKNOWN rate, LLM calls, elapsed time and input
token reduction.
