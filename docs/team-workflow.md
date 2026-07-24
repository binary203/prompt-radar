# Team workflow

## Branches

```text
main
work/b1nary-core
work/CMHOSHN-analytics
work/zardex-ui
```

Each teammate works only in their branch and owned folders. The core owner
merges into `main`.

## First integration contract

1. Core publishes `src/lib/contracts/analysis.ts`.
2. UI builds exclusively against `src/data/demo-analysis.json`.
3. Analytics returns an object accepted by `analysisResultSchema`.
4. Integration replaces mock input without changing UI data shapes.

## Checkpoints

- Every 30–60 minutes: small descriptive commit.
- Every 3 hours: push and report what works, what is blocked and what changed.
- First integration by hour 8.
- Feature freeze around hour 21.
- Final hours are for verification, backup demo recording and rehearsal.

## Commit style

```text
feat(ui): add scenario evidence table
feat(analytics): classify action prototypes
fix(core): handle multiline CSV records
test(analytics): cover DBSCAN noise points
docs(pitch): explain token reduction
```
