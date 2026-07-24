# Design direction: operational editorial

The dashboard should feel like an executive operations briefing assembled from
real evidence, not a template marketplace SaaS.

## Visual idea

`Prompt Radar` is a calm, dense signal room:

- warm paper background instead of pure white;
- near-black typography;
- signal orange for problems and decisions;
- dark teal for stable positive signals;
- acid yellow-green only for live/active markers;
- thin rules, square geometry and restrained 6–10 px radii;
- large editorial headlines paired with compact monospaced data labels.

## Layout

- 12-column desktop grid.
- A thin top rail with product mark, dataset state and navigation.
- The first screen starts with a one-sentence CTO briefing, not a marketing
  hero.
- Metrics form a continuous strip separated by rules, not floating cards.
- Scenarios use dense rows with evidence, confidence and deltas.
- Recommendations are ranked and numbered like an operational backlog.
- Mobile order: briefing, decisions, metrics, scenarios, methodology.

## Typography

Use system fonts to keep deployment deterministic:

- display/body: `Arial`, `Helvetica`, sans-serif;
- data labels: `ui-monospace`, `SFMono-Regular`, `Consolas`, monospace.

Use uppercase labels sparingly. Numbers use tabular figures.

## Forbidden patterns

- purple/blue gradients;
- glass panels and blur;
- enormous round corners;
- a centered hero with “AI-powered insights”;
- floating 3D shapes, blobs or decorative orbs;
- a grid of identical cards;
- excessive shadows;
- pill-shaped containers around every label;
- emojis as product icons;
- fake activity feeds or metrics;
- UMAP scatterplots without a business interpretation.

## Component rules

- A card exists only when content needs a distinct interaction or hierarchy.
- Borders carry hierarchy before shadows do.
- Every chart must answer a named business question.
- Every alert links to evidence or representative requests.
- Growth uses a signed number and comparison period.
- Error/proxy signals must be visually distinguished from confirmed failures.
