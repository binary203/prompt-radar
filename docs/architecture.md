# Архитектура

Фактический контекст и границы реализации описаны в
[project-context.md](project-context.md).

## Текущий checkpoint

```text
synthetic operational-log.jsonl
  → Zod validation
  → extractUserIntent
  → lexical taxonomy classifier
  → scenario либо UNKNOWN
  → aggregateEvents
  → calculateRoi
  → /api/checkpoint
  → web dashboard
```

### Runtime

- одно приложение Next.js 16;
- route handler работает в Node.js runtime;
- данные читаются из локального JSONL;
- расчёт кэшируется в памяти процесса;
- браузер получает готовый checkpoint JSON;
- база данных и отдельные workers отсутствуют.

### Основные модули

```text
src/lib/analytics/intent.ts       извлечение intent
src/lib/analytics/classifier.ts   lexical baseline и UNKNOWN
src/lib/analytics/aggregate.ts    operational metrics
src/lib/analytics/roi.ts          proxy-экономика
src/lib/providers/                OpenAI-compatible клиент
src/app/api/checkpoint/           сборка результата
src/app/checkpoint/               dashboard
```

OpenAI-compatible клиент протестирован отдельно, но не участвует в текущем
checkpoint pipeline.

## Целевая архитектура

```text
боевые operational events
  → нормализация и удаление дубликатов
  → intent extraction
  → cache известных intent
  → lexical + embedding prototype similarity
  → небольшой классификатор
  → local LLM fallback для UNKNOWN
  → clustering неизвестных intent
  → сценарии, тренды, проблемы и dashboard
```

Это направление развития, а не описание уже реализованных компонентов.

## Ограничения

- боевой источник данных не подключён;
- embeddings отсутствуют;
- ML-классификатор отсутствует;
- LLM fallback не подключён к checkpoint;
- автоматический clustering не реализован;
- состояние не сохраняется между перезапусками процесса.
