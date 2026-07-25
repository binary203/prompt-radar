# Prompt Radar

Аналитика сценариев и unit-экономики корпоративных ИИ-агентов для кейса КРОК
на Nuclear IT Hack School.

Prompt Radar отвечает не на вопрос «сколько сотрудники потратили токенов», а на
вопрос:

> Сколько подтверждённой ценности возвращает один рубль полной стоимости AI и
> где эта ценность теряется?

## Что делает продукт

На входе — OpenAI-compatible запросы и, если они доступны, operational traces:
результат выполнения, вызовы инструментов, повторные обращения и feedback.

На выходе:

- классификация запросов по типам задач;
- группировка в устойчивые бизнес-сценарии;
- карта спроса и проблемных сценариев;
- краткие объяснения representative requests;
- сравнение агентов по расходам и outcome;
- Potential Value, Realized Value, Value Gap, TCO и ROI;
- low / base / high вместо одной недоказуемой финансовой цифры.

```text
OpenAI-compatible payload
        ↓
извлечение текущего пользовательского намерения
        ↓
дешёвый классификатор → UNKNOWN → локальная LLM
        ↓
бизнес-сценарии + operational outcome
        ↓
Potential × Outcome Yield = Realized
        ↓
Realized − TCO = Net Value
```

## Важное различие

Мы не «считаем экономику всей компании по тексту промптов».

Из текста запроса можно оценить только **Potential Value**: какой тип работы
пользователь хотел выполнить и сколько ручного времени такой сценарий обычно
занимает. Чтобы говорить о **Realized Value**, нужны дополнительные сигналы:
успешный outcome, tool traces, отсутствие повторного запроса и feedback.

Токены и tool calls — это активность и стоимость. Сами по себе они не являются
пользой.

## Что уже работает

- воспроизводимый operational log за 60 дней;
- 188 разнообразных intent и 1 500 событий использования;
- извлечение вопроса из payload с RAG-контекстом;
- explainable baseline-классификатор и UNKNOWN fallback;
- агрегация MAU, usage, success, repeat и метрик по сценариям/агентам;
- расчёт Potential / Realized / Value Gap / TCO / ROI;
- тёмный executive checkpoint;
- OpenAI-compatible клиент для локальной или внешней модели;
- 22 автоматических теста.

Демонстрационный прогон на синтетике при базовых допущениях даёт:

| Метрика | Значение |
| --- | ---: |
| События | 1 500 |
| Токены | 1,38 млн |
| Tool calls | 3 950 |
| Potential Value | 2,46 млн ₽ |
| Realized Value | 848,6 тыс. ₽ |
| TCO | 500,9 тыс. ₽ |
| Возврат на 1 ₽ TCO | 1,69 ₽ |
| Base ROI | +69,4% |

Это демонстрация методики, а не заявление о реальном ROI КРОК. На боевых логах
формулы сохраняются, но стоимость ручной работы и TCO калибруются заказчиком.

## Датасет

Датасет разделён на два слоя:

1. `188` уникальных запросов с gold-разметкой проверяют качество извлечения и
   классификации. Тысячи почти одинаковых перефразов искусственно завысили бы
   accuracy.
2. `1 500` operational events моделируют 60 дней работы: даты, пользователей,
   агента, токены, tool calls, outcome, повторы и feedback. Этот слой нужен для
   трендов и экономики.

Gold labels не передаются анализатору и используются только для оценки
качества.

## Быстрый старт

Требуется Node.js 22+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Открыть:

- <http://localhost:3000> — основной checkpoint;
- <http://localhost:3000/checkpoint> — прямой URL того же экрана;
- <http://localhost:3000/api/checkpoint> — исходный JSON расчёта;
- <http://localhost:3000/api/health> — health check.

Без API-ключа checkpoint полностью работает на синтетических данных.

## OpenAI-compatible модель

Проект не привязан к конкретному провайдеру. Подойдёт локальная модель или
совместимый внешний endpoint:

```dotenv
AI_BASE_URL=
AI_API_KEY=
AI_CHAT_MODEL=
AI_EMBEDDING_MODEL=
```

LLM не должна обрабатывать каждый запрос. Очевидные intent проходит дешёвый
детерминированный классификатор, а в модель уходят только UNKNOWN и
низкоуверенные случаи. Это снижает стоимость и делает основную маршрутизацию
воспроизводимой.

## Команды

```bash
npm run generate:dataset  # заново собрать operational log
npm run check             # lint + TypeScript + 22 теста
npm run build             # production build для Vercel
npm run dev               # локальная разработка
```

## Архитектура

MVP — одно приложение на Next.js 16 / React 19 / TypeScript:

- server route читает compact JSONL и выполняет расчёт;
- чистые функции извлекают intent, классифицируют, агрегируют и считают ROI;
- результат кэшируется в процессе;
- браузер получает только готовый checkpoint JSON;
- база данных, Python и тяжёлые ML-библиотеки не нужны;
- секрет провайдера никогда не попадает в клиентский код.

Боевой источник данных — экспорт или адаптер корпоративного AI gateway /
OpenTelemetry. Устанавливать программу на каждый компьютер и «подглядывать» за
терминалом сотрудников для работы метода не требуется.

## Структура

```text
src/
  app/
    api/checkpoint/       воспроизводимый server-side расчёт
    checkpoint/           основной интерфейс
  data/synthetic/         taxonomy, gold labels, variants, operational log
  lib/
    analytics/            intent, classifier, aggregate, ROI
    contracts/            Zod-контракты входных и выходных данных
    providers/            OpenAI-compatible HTTP client
scripts/                  генератор синтетического operational log
tests/                    контракты, аналитика, провайдер и dataset
docs/                     архитектура, методика и сценарий защиты
```

## Методика

Упрощённо для события:

```text
Potential Minutes = ручное время типового сценария

Outcome Yield =
  Success Factor
  × (1 − Repeat Penalty)
  × (1 − Review Rate)
  × Feedback Factor

Realized Value = Potential Minutes × Outcome Yield × стоимость минуты
Net Value      = Realized Value − TCO
ROI            = Net Value / TCO
```

Часть величин измеряется в логах, часть явно задаётся как предположение.
Интерфейс не смешивает эти уровни доказательности.

Подробнее:

- [сценарий защиты](docs/pitch.md);
- [методика расчёта](docs/methodology.md);
- [checkpoint и порядок демонстрации](docs/checkpoint.md);
- [архитектура](docs/architecture.md).

## Ограничения MVP

- текущие финансовые результаты получены на синтетике;
- manual minutes и review rate требуют интервью и калибровки;
- нет постоянного хранилища и многопользовательской авторизации;
- baseline-классификатор нужен как объяснимый первый каскад, а не как замена
  корпоративной модели;
- отсутствие outcome позволяет показывать Potential, но не доказывает Realized
  Value.
