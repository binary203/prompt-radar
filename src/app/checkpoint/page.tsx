"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import taxonomyData from "@/data/synthetic/taxonomy.json";
import {
  buildCheckpoint,
  createRemoteLlmClassifier,
  parseOperationalLog,
  type Taxonomy,
} from "@/lib/analytics";
import { DatasetLoader } from "@/components/DatasetLoader";

import styles from "./page.module.css";

type Band = {
  low: number;
  base: number;
  high: number;
};

type NullableBand = {
  low: number | null;
  base: number | null;
  high: number | null;
};

type AgentMetrics = {
  requests: number;
  activeUsers: number;
  toolCalls: number;
  totalTokens: number;
  successRate: number;
  repeatRate: number;
};

type TrendPoint = {
  date: string;
  label: string;
  requests: number;
  activeUsers: number;
  tokens: number;
  successRate: number;
  repeatRate: number;
};

type SegmentMetrics = {
  name: string;
  requests: number;
  tasks: number;
  activeUsers: number;
  tokens: number;
  successRate: number;
  reworkRate: number;
  realizedValueRub: number;
  valueGapRub: number;
  fteMonthsRealized: number;
  netValueRub: number;
};

type PipelineLayer = {
  id: string;
  title: string;
  received: number;
  resolved: number;
  costRub: number;
  note: string;
};

type Estimate = "low" | "base" | "high";

type ValueBand = {
  realizedMinutes: number;
  potentialMinutes: number;
  savedHours: number;
  savedWorkdays: number;
  fteMonths: number;
  netValueRub: number;
  valueGapRub: number;
  costPerSavedMinuteRub: number;
  profitable: boolean;
};

type ProblemCell = {
  key: string;
  rate: number;
  numerator: number;
  denominator: number;
  severity: "ok" | "watch" | "act";
};

type ProblemRow = {
  key: string;
  title: string;
  tasks: number;
  valueGapRub: number;
  cells: ProblemCell[];
  worst: string | null;
};

type DiscoveredUseCase = {
  size: number;
  terms: string[];
  representative: string;
  cohesion: number;
};

type CheckpointResponse = {
  generatedAt: string;
  source: string;
  dataset: {
    events: number;
    tasks: number;
    uniqueIntents: number;
    periodDays: number;
    activeUsers: number;
    mau: number;
    period: {
      from: string | null;
      to: string | null;
    };
  };
  usage: {
    toolCalls: number;
    toolErrors: number;
    toolErrorRate: number;
    tokens: number;
    successes: number;
    partials: number;
    errors: number;
    repeats: number;
    successRate: number;
    repeatRate: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  tasks: {
    count: number;
    succeeded: number;
    reworked: number;
    successRate: number;
    reworkRate: number;
    attemptsPerTask: number;
  };
  economics: {
    assumptions: {
      effectiveManualMinutesPerTask: Band;
      taskCount: number;
    };
    potentialValueRub: Band;
    realizedValueRub: Band;
    valueGapRub: Band;
    tcoRub: {
      tokenCost: number;
      fixedCost: number;
      team: number;
      infrastructure: number;
      licenses: number;
      amortization: number;
      other: number;
      total: number;
    };
    roi: NullableBand;
    returnPerRuble: NullableBand;
    fteMonthsRealized: Band;
    fteMonthsPotential: Band;
  };
  value: {
    bands: Record<Estimate, ValueBand>;
    tokens: number;
    tokenCostRub: number;
    tokenShareOfTco: number;
    salaryPerMinuteRub: number;
  };
  problems: {
    columns: Array<{ key: string; title: string; meaning: string }>;
    rows: ProblemRow[];
    note: string;
  };
  evaluation: {
    evaluated: number;
    scenarioTop1Accuracy: number;
    actionAccuracy: number;
    domainAccuracy: number;
    predictedUnknownRate: number;
  };
  pipeline: {
    layers: PipelineLayer[];
    extraction: {
      sourceChars: number;
      intentChars: number;
      compressionRatio: number;
    };
    cache: {
      uniqueIntents: number;
      hits: number;
      hitRate: number;
    };
    llm: {
      configured: boolean;
      model: string | null;
      calls: number;
      budget: number;
      deferred: number;
      note: string;
    };
    costs: {
      actualRub: number;
      everythingToLlmRub: number;
      savedRub: number;
      perLlmCallRub: number;
    };
    unresolved: number;
  };
  discovery: {
    clusters: DiscoveredUseCase[];
  };
  agents: Record<string, AgentMetrics>;
  departments: SegmentMetrics[];
  roles: SegmentMetrics[];
  trend: TrendPoint[];
  topScenarios: Array<{
    id: string;
    title: string;
    requests: number;
    tasks: number;
    successRate: number;
    repeatRate: number;
    tokens: number;
    manualMinutes: number;
    potentialValueRub: number;
    realizedValueRub: number;
    valueGapRub: number;
  }>;
  intentExtractionDemo: {
    sourceChars: number;
    extractedChars: number;
    compressionRatio: number;
    extracted: string;
    routed: string;
  } | null;
  disclaimer: string;
};

const bands: readonly Estimate[] = ["low", "base", "high"];

const BAND_TITLES: Record<Estimate, string> = {
  low: "Пессимистичный",
  base: "Базовый",
  high: "Оптимистичный",
};

export default function CheckpointPage() {
  const [demo, setDemo] = useState<CheckpointResponse | null>(null);
  const [uploaded, setUploaded] = useState<CheckpointResponse | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // One control drives every money figure on the page. Showing base only would
  // hide the fact that the pessimistic case is negative.
  const [band, setBand] = useState<Estimate>("base");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/checkpoint", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<CheckpointResponse>;
      })
      .then(setDemo)
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== "AbortError") {
          setError(reason.message);
        }
      });

    return () => controller.abort();
  }, []);

  /**
   * The uploaded log is analysed here, in the tab, with the same function the
   * server runs on the demo data. Nothing is uploaded anywhere — the only
   * request that can leave is the model layer, and it carries an extracted
   * question rather than the log.
   */
  const analyseUpload = useCallback(
    async (contents: string, fileName: string) => {
      setBusy(true);
      setNotice("");

      try {
        const parsed = parseOperationalLog(contents);

        if (parsed.events.length === 0) {
          setNotice(
            parsed.problems.join(" ") || "В файле не нашлось событий.",
          );
          return;
        }

        const checkpoint = await buildCheckpoint({
          events: parsed.events,
          taxonomy: taxonomyData as Taxonomy,
          llm: await createRemoteLlmClassifier(),
          sourceLabel: fileName,
        });

        setUploaded(checkpoint as unknown as CheckpointResponse);
        setNotice(
          [
            `Разобрано ${parsed.events.length} из ${parsed.totalLines} записей.`,
            ...parsed.problems,
          ].join(" "),
        );
      } catch (reason: unknown) {
        setNotice(
          reason instanceof Error
            ? `Расчёт не завершён: ${reason.message}`
            : "Расчёт не завершён.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (error) {
    return <ErrorState message={error} />;
  }

  const data = uploaded ?? demo;

  if (!data) {
    return <LoadingState />;
  }

  // Channel names come from the log, so an uploaded dataset with its own agent
  // names renders exactly as well as the demo one.
  const channels = Object.entries(data.agents)
    .sort(([, left], [, right]) => right.requests - left.requests)
    .slice(0, 4)
    .map(([name, metrics]): [string, AgentMetrics] => [name, metrics]);
  const value = data.value.bands[band];
  const netValue =
    data.economics.realizedValueRub[band] - data.economics.tcoRub.total;
  // Cost per successful task, not per successful event: retries of the same
  // task are cost, not extra results.
  const costPerSuccess =
    data.tasks.succeeded > 0
      ? data.economics.tcoRub.total / data.tasks.succeeded
      : 0;
  const requestDelta = calculateDelta(
    data.trend[0]?.requests,
    data.trend.at(-1)?.requests,
  );
  const successDelta =
    (data.trend.at(-1)?.successRate ?? data.usage.successRate) -
    (data.trend[0]?.successRate ?? data.usage.successRate);

  return (
    <div className={styles.app}>
      <Sidebar />

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <span>Аналитика</span>
            <i>/</i>
            <strong>Обзор</strong>
          </div>
          <div className={styles.topbarMeta}>
            <span className={styles.statusDot} aria-hidden="true" />
            {data.source}
            <span className={styles.topbarDivider} />
            Обновлено {formatTime(data.generatedAt)}
          </div>
        </header>

        <main className={styles.main}>
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}

          {/* Screen shows this in the sidebar and topbar, both hidden in print. */}
          <div className={styles.printHeader}>
            <strong>Prompt Radar — отчёт по AI-агентам</strong>
            <span>
              {data.source} · {formatPeriod(data.dataset.period)} ·{" "}
              {data.dataset.periodDays} дней · {BAND_TITLES[band]} сценарий
            </span>
            <span>Сформировано {formatTime(data.generatedAt)}</span>
          </div>

          <section className={styles.pageHeader} id="overview">
            <div>
              <p className={styles.eyebrow}>Корпоративные AI-агенты</p>
              <h1>Обзор использования</h1>
              <p className={styles.pageDescription}>
                Спрос, качество выполнения и экономика за{" "}
                {data.dataset.periodDays} дней
              </p>
            </div>
            <div className={styles.actions}>
              <div className={styles.periodControl}>
                <CalendarIcon />
                <span>{formatPeriod(data.dataset.period)}</span>
              </div>
              <DatasetLoader
                busy={busy}
                onError={setNotice}
                onFile={analyseUpload}
              />
              {uploaded ? (
                <button
                  className={styles.ghostButton}
                  onClick={() => {
                    setUploaded(null);
                    setNotice("");
                  }}
                  type="button"
                >
                  К демо-датасету
                </button>
              ) : (
                <Link className={styles.ghostButton} href="/api/checkpoint">
                  JSON
                </Link>
              )}
              <button
                className={styles.primaryButton}
                onClick={() => window.print()}
                type="button"
              >
                <DownloadIcon />
                Экспорт PDF
              </button>
            </div>
          </section>

          <section className={styles.kpiStrip} aria-label="Ключевые показатели">
            <Kpi
              label="Запросы"
              value={formatInteger(data.dataset.events)}
              note={`${formatInteger(data.tasks.count)} задач · ${formatSignedPercent(requestDelta)} к первой неделе`}
            />
            <Kpi
              label="Активные пользователи"
              value={formatInteger(data.dataset.activeUsers)}
              note={`MAU ${Math.round(data.dataset.mau)}`}
            />
            <Kpi
              label="Задачи с результатом"
              value={formatPercent(data.tasks.successRate)}
              note={`${formatSignedPoints(successDelta)} за период`}
              tone="positive"
            />
            <Kpi
              label="Высвобождено FTE"
              value={formatFte(data.economics.fteMonthsRealized.base)}
              note={`из ${formatFte(data.economics.fteMonthsPotential.base)} потенциальных`}
              tone="positive"
            />
            <Kpi
              label="Задачи с переспросом"
              value={formatPercent(data.tasks.reworkRate)}
              note={`${formatInteger(data.tasks.reworked)} задач переформулировали`}
              tone="warning"
            />
            <Kpi
              label="Стоимость результата"
              value={formatRubles(costPerSuccess)}
              note={`TCO / ${formatInteger(data.tasks.succeeded)} решённых задач`}
            />
          </section>

          <section className={styles.scenarios} id="value">
            <PanelHeader
              title="Что это дало"
              subtitle={`Подтверждённая польза за период · ${BAND_TITLES[band].toLowerCase()} сценарий`}
            >
              <BandSwitch onChange={setBand} value={band} />
            </PanelHeader>

            <p className={styles.valueHeadline}>
              Минута высвобожденного времени обходится в{" "}
              <strong>
                {formatRublesPrecise(value.costPerSavedMinuteRub)}
              </strong>{" "}
              при стоимости минуты сотрудника{" "}
              <strong>
                {formatRublesPrecise(data.value.salaryPerMinuteRub)}
              </strong>
              .{" "}
              {value.profitable
                ? "Покупать это время у агента дешевле, чем оплачивать его людям."
                : "Пока дороже, чем оплачивать это время людям."}
            </p>

            <div className={styles.valueGrid}>
              <ValueMetric
                label="Высвобождено времени"
                value={`${formatInteger(value.savedWorkdays)} раб. дней`}
                note={`${formatInteger(value.savedHours)} часов · ${formatFte(value.fteMonths)}`}
              />
              <ValueMetric
                label="Чистая выгода"
                value={formatSignedRubles(value.netValueRub)}
                note={`Realized ${formatRubles(data.economics.realizedValueRub[band])} − TCO ${formatRubles(data.economics.tcoRub.total)}`}
                tone={value.netValueRub >= 0 ? "positive" : "warning"}
              />
              <ValueMetric
                label="Потрачено токенов"
                value={formatCompact(data.value.tokens)}
                note={`${formatRubles(data.value.tokenCostRub)} — ${formatPercent(data.value.tokenShareOfTco)} TCO`}
              />
              <ValueMetric
                label="Не дошло до пользы"
                value={formatRubles(value.valueGapRub)}
                note={`${formatInteger(value.potentialMinutes - value.realizedMinutes)} минут потенциала`}
                tone="warning"
              />
            </div>
          </section>

          <section className={styles.scenarios} id="problems">
            <PanelHeader
              title="Что чинить в первую очередь"
              subtitle="Сценарии сверху вниз по потерянным деньгам"
            >
              <span className={styles.tableHint}>
                Пороги считаются от базовой линии этого лога
              </span>
            </PanelHeader>

            <div className={styles.tableWrap}>
              <table className={styles.heatTable}>
                <thead>
                  <tr>
                    <th>Сценарий</th>
                    <th>Задачи</th>
                    <th>Потери</th>
                    {data.problems.columns.map((column) => (
                      <th key={column.key} title={column.meaning}>
                        {column.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.problems.rows.slice(0, 10).map((row) => (
                    <ProblemGridRow key={row.key} row={row} />
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.panelFootnote}>{data.problems.note}</p>
          </section>

          <section className={styles.primaryGrid}>
            <article className={styles.panel}>
              <PanelHeader
                title="Динамика использования"
                subtitle="Запросы и success rate по неделям"
              >
                <div className={styles.legend}>
                  <span>
                    <i className={styles.legendBar} />
                    Запросы
                  </span>
                  <span>
                    <i className={styles.legendLine} />
                    Success rate
                  </span>
                </div>
              </PanelHeader>
              <TrendChart points={data.trend} />
            </article>

            <article className={styles.panel}>
              <PanelHeader
                title="Результаты выполнения"
                subtitle={`${formatInteger(data.dataset.events)} событий`}
              />
              <OutcomeChart data={data} />
              <div className={styles.operationalFacts}>
                <div>
                  <span>Tool error rate</span>
                  <strong>{formatPercent(data.usage.toolErrorRate)}</strong>
                </div>
                <div>
                  <span>P95 latency</span>
                  <strong>{formatDuration(data.usage.p95LatencyMs)}</strong>
                </div>
              </div>
            </article>
          </section>

          <section className={styles.economics} id="economics">
            <PanelHeader
              title="Экономика пилота"
              subtitle={`${BAND_TITLES[band]} сценарий · TCO аллоцирован на период лога`}
            >
              <div className={styles.economicSummary}>
                <BandSwitch onChange={setBand} value={band} />
                <span>
                  ROI{" "}
                  <strong>{formatSignedPercent(data.economics.roi[band])}</strong>
                </span>
                <span>
                  Возврат / 1 ₽{" "}
                  <strong>
                    {formatRatio(data.economics.returnPerRuble[band])} ₽
                  </strong>
                </span>
                <span>
                  Net value <strong>{formatSignedRubles(netValue)}</strong>
                </span>
              </div>
            </PanelHeader>

            <div className={styles.economicsGrid}>
              <ValueBreakdown band={band} data={data} />

              <div className={styles.sensitivity}>
                <h3>Чувствительность модели</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Сценарий</th>
                      <th>Realized</th>
                      <th>ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bands.map((candidate) => (
                      <tr
                        aria-current={candidate === band ? "true" : undefined}
                        className={
                          candidate === band ? styles.selectedRow : undefined
                        }
                        key={candidate}
                      >
                        <th scope="row">{BAND_TITLES[candidate]}</th>
                        <td>
                          {formatRubles(
                            data.economics.realizedValueRub[candidate],
                          )}
                        </td>
                        <td>
                          {formatSignedPercent(data.economics.roi[candidate])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Ручное время задано посценарно, средневзвешенно{" "}
                  {formatMinutes(
                    data.economics.assumptions.effectiveManualMinutesPerTask
                      .base,
                  )}{" "}
                  на задачу. Спрос считается по{" "}
                  {formatInteger(data.tasks.count)} задачам, повторные попытки
                  остаются в стоимости и не вычитаются из ценности дважды.
                </p>
              </div>
            </div>
          </section>

          <section className={styles.secondaryGrid}>
            <article className={styles.panel}>
              <PanelHeader
                title="Сравнение каналов"
                subtitle="Ресурсоёмкость и качество outcome"
              />
              <AgentComparison agents={channels} />
            </article>

            <article className={styles.panel} id="quality">
              <PanelHeader
                title="Качество классификации"
                subtitle={
                  data.evaluation.evaluated > 0
                    ? `${data.evaluation.evaluated} уникальных intent`
                    : "Нет эталонной разметки для этого датасета"
                }
              />
              <div className={styles.qualityMetrics}>
                <QualityMetric
                  label="Scenario top-1"
                  value={data.evaluation.scenarioTop1Accuracy}
                />
                <QualityMetric
                  label="Action accuracy"
                  value={data.evaluation.actionAccuracy}
                />
                <QualityMetric
                  label="Domain accuracy"
                  value={data.evaluation.domainAccuracy}
                />
                <QualityMetric
                  label="UNKNOWN"
                  value={data.evaluation.predictedUnknownRate}
                  neutral
                />
              </div>
              {data.intentExtractionDemo && (
                <div className={styles.intentEvidence}>
                  <span>
                    Из{" "}
                    {formatInteger(data.intentExtractionDemo.sourceChars)}{" "}
                    символов payload осталось{" "}
                    {formatInteger(data.intentExtractionDemo.extractedChars)} —
                    сжатие в{" "}
                    {Math.round(data.intentExtractionDemo.compressionRatio)} раз
                  </span>
                  <strong>“{data.intentExtractionDemo.extracted}”</strong>
                  <small>→ {data.intentExtractionDemo.routed}</small>
                </div>
              )}
            </article>
          </section>

          <section className={styles.scenarios} id="pipeline">
            <PanelHeader
              title="Конвейер классификации"
              subtitle="Пять слоёв, от бесплатного к платному"
            >
              <span className={styles.tableHint}>
                {formatPercent(data.pipeline.cache.hitRate)} снимает кэш ·{" "}
                {formatRubles(data.pipeline.costs.savedRub)} не ушло в модель
              </span>
            </PanelHeader>

            <div className={styles.tableWrap}>
              <table className={styles.scenarioTable}>
                <thead>
                  <tr>
                    <th>Слой</th>
                    <th>Вошло</th>
                    <th>Ответил</th>
                    <th>Доля входа</th>
                    <th>Стоимость</th>
                    <th>Что делает</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pipeline.layers.map((layer) => (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      total={data.dataset.events}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.panelFootnote}>
              До модели дошло{" "}
              {formatInteger(
                data.pipeline.layers.find((layer) => layer.id === "llm")
                  ?.received ?? 0,
              )}{" "}
              из {formatInteger(data.dataset.events)} запросов.{" "}
              {data.pipeline.llm.configured
                ? `Модель ${data.pipeline.llm.model}, вызовов ${formatInteger(data.pipeline.llm.calls)} по ${formatRubles(data.pipeline.costs.perLlmCallRub)}.`
                : `Провайдер не подключён: ${formatInteger(data.pipeline.llm.deferred)} намерений остались нераспознанными.`}{" "}
              Разбор всего потока моделью стоил бы{" "}
              {formatRubles(data.pipeline.costs.everythingToLlmRub)}.
            </p>
          </section>

          {data.discovery.clusters.length > 0 && (
            <section className={styles.scenarios} id="discovery">
              <PanelHeader
                title="Спрос без сценария"
                subtitle="Кластеры запросов, которым таксономия не даёт названия"
              >
                <span className={styles.tableHint}>
                  {formatInteger(data.pipeline.unresolved)} запросов вне
                  таксономии
                </span>
              </PanelHeader>

              <div className={styles.tableWrap}>
                <table className={styles.scenarioTable}>
                  <thead>
                    <tr>
                      <th>Группа</th>
                      <th>Запросов</th>
                      <th>Плотность</th>
                      <th>Типичный запрос</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.discovery.clusters.map((cluster) => (
                      <tr key={cluster.representative}>
                        <th scope="row">
                          <strong>{cluster.terms.join(" · ")}</strong>
                        </th>
                        <td>{formatInteger(cluster.size)}</td>
                        <td>{formatPercent(cluster.cohesion)}</td>
                        <td className={styles.quoteCell}>
                          {cluster.representative}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className={styles.scenarios} id="departments">
            <PanelHeader
              title="Ценность по департаментам"
              subtitle="Кто получает измеримую отдачу, а кто пока нет"
            >
              <span className={styles.tableHint}>
                TCO аллоцирован по доле токенов
              </span>
            </PanelHeader>

            <div className={styles.tableWrap}>
              <table className={styles.scenarioTable}>
                <thead>
                  <tr>
                    <th>Департамент</th>
                    <th>Задачи</th>
                    <th>Люди</th>
                    <th>Success</th>
                    <th>Переспрос</th>
                    <th>FTE</th>
                    <th>Realized</th>
                    <th>Net value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departments.map((segment) => (
                    <SegmentRow
                      key={segment.name}
                      maxTasks={data.departments[0]?.tasks ?? 1}
                      segment={segment}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.scenarios} id="scenarios">
            <PanelHeader
              title="Сценарии использования"
              subtitle="Отсортировано по объёму запросов"
            >
              <span className={styles.tableHint}>
                Baseline top-1{" "}
                {formatPercent(data.evaluation.scenarioTop1Accuracy)}
              </span>
            </PanelHeader>

            <div className={styles.tableWrap}>
              <table className={styles.scenarioTable}>
                <thead>
                  <tr>
                    <th>Бизнес-сценарий</th>
                    <th>Объём</th>
                    <th>Success</th>
                    <th>Repeat</th>
                    <th>Ручное время</th>
                    <th>Realized</th>
                    <th>Value Gap</th>
                    <th>Tokens / req</th>
                    <th>Сигнал</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topScenarios.map((scenario) => (
                    <ScenarioRow
                      key={scenario.id}
                      maxRequests={data.topScenarios[0]?.requests ?? 1}
                      scenario={scenario}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className={styles.footer}>
            <span>Prompt Radar · MEPHI × CROC · 2026</span>
            <p>{data.disclaimer}</p>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/">
        <span>PR</span>
        <strong>Prompt Radar</strong>
      </Link>
      <nav aria-label="Разделы dashboard">
        <a className={styles.activeNav} href="#overview">
          <OverviewIcon />
          Обзор
        </a>
        <a href="#value">
          <ValueIcon />
          Польза
        </a>
        <a href="#problems">
          <ProblemsIcon />
          Что чинить
        </a>
        <a href="#pipeline">
          <PipelineIcon />
          Конвейер
        </a>
        <a href="#scenarios">
          <DemandIcon />
          Сценарии
        </a>
        <a href="#departments">
          <DepartmentsIcon />
          Департаменты
        </a>
        <a href="#economics">
          <EconomicsIcon />
          Экономика
        </a>
        <a href="#quality">
          <QualityIcon />
          Качество
        </a>
      </nav>
      <div className={styles.sidebarFooter}>
        <span>Источник</span>
        <strong>
          <i aria-hidden="true" />
          Операционный лог
        </strong>
        <small>1 500 событий · 60 дней</small>
      </div>
    </aside>
  );
}

function LoadingState() {
  return (
    <main className={styles.state}>
      <div className={styles.loadingMark}>PR</div>
      <span>CHECKPOINT / ANALYSIS</span>
      <h1>Собираем dashboard</h1>
      <div className={styles.loadingBar}>
        <i />
      </div>
      <p>Intent → scenarios → outcomes → economics</p>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className={styles.state}>
      <div className={styles.loadingMark}>PR</div>
      <span>CHECKPOINT / ERROR</span>
      <h1>Расчёт не завершён</h1>
      <p>{message}</p>
    </main>
  );
}

function Kpi({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "default" | "positive" | "warning";
}) {
  return (
    <div className={styles.kpi}>
      <span>{label}</span>
      <strong
        className={
          tone === "positive"
            ? styles.positiveText
            : tone === "warning"
              ? styles.warningText
              : undefined
        }
      >
        {value}
      </strong>
      <small>{note}</small>
    </div>
  );
}

function PanelHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={styles.panelHeader}>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </header>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <p className={styles.empty}>Нет данных за выбранный период.</p>;
  }

  const width = 760;
  const height = 250;
  const plotLeft = 34;
  const plotRight = 24;
  const plotTop = 20;
  const plotBottom = 42;
  const plotWidth = width - plotLeft - plotRight;
  const plotHeight = height - plotTop - plotBottom;
  const maxRequests = Math.max(...points.map((point) => point.requests), 1);
  const slot = plotWidth / points.length;
  const barWidth = Math.min(38, slot * 0.5);
  const successPoints = points
    .map((point, index) => {
      const x = plotLeft + slot * index + slot / 2;
      const y = plotTop + plotHeight * (1 - point.successRate);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className={styles.chartWrap}>
      <svg
        aria-label="Запросы и доля успешных исходов по неделям"
        className={styles.trendChart}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 0.5, 1].map((step) => {
          const y = plotTop + plotHeight * step;
          return (
            <g key={step}>
              <line
                className={styles.gridLine}
                x1={plotLeft}
                x2={width - plotRight}
                y1={y}
                y2={y}
              />
              <text
                className={styles.axisText}
                textAnchor="end"
                x={plotLeft - 8}
                y={y + 3}
              >
                {Math.round(maxRequests * (1 - step))}
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const x = plotLeft + slot * index + (slot - barWidth) / 2;
          const barHeight = (point.requests / maxRequests) * plotHeight;
          return (
            <g key={point.date}>
              <rect
                className={styles.requestBar}
                height={barHeight}
                rx="2"
                width={barWidth}
                x={x}
                y={plotTop + plotHeight - barHeight}
              />
              <text
                className={styles.axisText}
                textAnchor="middle"
                x={x + barWidth / 2}
                y={height - 14}
              >
                {point.label}
              </text>
            </g>
          );
        })}
        <polyline className={styles.successLine} points={successPoints} />
        {points.map((point, index) => {
          const x = plotLeft + slot * index + slot / 2;
          const y = plotTop + plotHeight * (1 - point.successRate);
          return (
            <circle
              className={styles.successPoint}
              cx={x}
              cy={y}
              key={point.date}
              r="3.5"
            />
          );
        })}
      </svg>
    </div>
  );
}

function OutcomeChart({ data }: { data: CheckpointResponse }) {
  const outcomes = [
    {
      label: "Success",
      value: data.usage.successes,
      className: styles.outcomeSuccess,
    },
    {
      label: "Partial",
      value: data.usage.partials,
      className: styles.outcomePartial,
    },
    {
      label: "Error",
      value: data.usage.errors,
      className: styles.outcomeError,
    },
    {
      label: "Unknown",
      value: Math.max(
        0,
        data.dataset.events -
          data.usage.successes -
          data.usage.partials -
          data.usage.errors,
      ),
      className: styles.outcomeUnknown,
    },
  ];
  let offset = 0;

  return (
    <div className={styles.outcomeLayout}>
      <div className={styles.donut}>
        <svg viewBox="0 0 120 120">
          <circle className={styles.donutBase} cx="60" cy="60" r="48" />
          {outcomes.map((outcome) => {
            const share = outcome.value / data.dataset.events;
            const currentOffset = offset;
            offset += share * 100;
            return (
              <circle
                className={outcome.className}
                cx="60"
                cy="60"
                key={outcome.label}
                pathLength="100"
                r="48"
                style={{
                  strokeDasharray: `${share * 100} ${100 - share * 100}`,
                  strokeDashoffset: -currentOffset,
                }}
              />
            );
          })}
        </svg>
        <div>
          <strong>{formatPercent(data.usage.successRate)}</strong>
          <span>success</span>
        </div>
      </div>
      <dl className={styles.outcomeLegend}>
        {outcomes.map((outcome) => (
          <div key={outcome.label}>
            <dt>
              <i className={outcome.className} />
              {outcome.label}
            </dt>
            <dd>
              <strong>{formatInteger(outcome.value)}</strong>
              <span>
                {formatPercent(outcome.value / data.dataset.events)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ValueBreakdown({
  data,
  band,
}: {
  data: CheckpointResponse;
  band: Estimate;
}) {
  const potential = data.economics.potentialValueRub[band];
  const rows = [
    {
      label: "Potential value",
      value: potential,
      className: styles.valuePotential,
    },
    {
      label: "Realized value",
      value: data.economics.realizedValueRub[band],
      className: styles.valueRealized,
    },
    {
      label: "TCO",
      value: data.economics.tcoRub.total,
      className: styles.valueTco,
    },
    {
      label: "Value gap",
      value: data.economics.valueGapRub[band],
      className: styles.valueGap,
    },
  ];
  const tcoParts = [
    ["Команда", data.economics.tcoRub.team, styles.tcoTeam],
    [
      "Инфраструктура",
      data.economics.tcoRub.infrastructure,
      styles.tcoInfrastructure,
    ],
    ["Лицензии", data.economics.tcoRub.licenses, styles.tcoLicenses],
    [
      "Амортизация",
      data.economics.tcoRub.amortization,
      styles.tcoAmortization,
    ],
    ["Токены", data.economics.tcoRub.tokenCost, styles.tcoTokens],
  ] as const;

  return (
    <div className={styles.valueBreakdown}>
      <div className={styles.valueRows}>
        {rows.map((row) => (
          <div className={styles.valueRow} key={row.label}>
            <div>
              <span>{row.label}</span>
              <strong>{formatRubles(row.value)}</strong>
            </div>
            <div className={styles.valueTrack}>
              <i
                className={row.className}
                style={{
                  width: `${Math.max(2, (row.value / potential) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className={styles.tcoComposition}>
        <div>
          <h3>Структура TCO</h3>
          <span>{formatRubles(data.economics.tcoRub.total)}</span>
        </div>
        <div className={styles.tcoBar}>
          {tcoParts.map(([label, value, className]) => (
            <i
              aria-label={`${label}: ${formatRubles(value)}`}
              className={className}
              key={label}
              style={{
                width: `${(value / data.economics.tcoRub.total) * 100}%`,
              }}
              title={`${label}: ${formatRubles(value)}`}
            />
          ))}
        </div>
        <div className={styles.tcoLegend}>
          {tcoParts.map(([label, value, className]) => (
            <span key={label}>
              <i className={className} />
              {label} {formatPercent(value / data.economics.tcoRub.total)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentComparison({
  agents,
}: {
  agents: Array<[string, AgentMetrics | undefined]>;
}) {
  const available = agents.filter(
    (entry): entry is [string, AgentMetrics] => Boolean(entry[1]),
  );
  const maxTokensPerRequest = Math.max(
    ...available.map(([, metrics]) =>
      safeRatio(metrics.totalTokens, metrics.requests),
    ),
    1,
  );

  return (
    <div className={styles.agentComparison}>
      <div className={styles.agentHeader}>
        <span>Канал</span>
        <span>Tokens / req</span>
        <span>Success</span>
        <span>Repeat</span>
      </div>
      {available.map(([name, metrics]) => {
        const tokensPerRequest = safeRatio(
          metrics.totalTokens,
          metrics.requests,
        );
        return (
          <div className={styles.agentRow} key={name}>
            <div>
              <strong>{name}</strong>
              <span>
                {metrics.activeUsers} users · {metrics.requests} requests
              </span>
            </div>
            <div className={styles.agentTokenCell}>
              <strong>{formatCompact(tokensPerRequest)}</strong>
              <span>
                <i
                  style={{
                    width: `${(tokensPerRequest / maxTokensPerRequest) * 100}%`,
                  }}
                />
              </span>
            </div>
            <strong>{formatPercent(metrics.successRate)}</strong>
            <strong
              className={
                metrics.repeatRate > 0.14 ? styles.warningText : undefined
              }
            >
              {formatPercent(metrics.repeatRate)}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function QualityMetric({
  label,
  value,
  neutral = false,
}: {
  label: string;
  value: number;
  neutral?: boolean;
}) {
  return (
    <div className={styles.qualityMetric}>
      <span>{label}</span>
      <strong>{formatPercent(value)}</strong>
      <i>
        <span
          className={neutral ? styles.neutralProgress : undefined}
          style={{ width: `${value * 100}%` }}
        />
      </i>
    </div>
  );
}

function BandSwitch({
  value,
  onChange,
}: {
  value: Estimate;
  onChange: (next: Estimate) => void;
}) {
  return (
    <div className={styles.bandSwitch} role="group" aria-label="Сценарий оценки">
      {bands.map((candidate) => (
        <button
          aria-pressed={candidate === value}
          className={candidate === value ? styles.bandActive : undefined}
          key={candidate}
          onClick={() => onChange(candidate)}
          type="button"
        >
          {BAND_TITLES[candidate]}
        </button>
      ))}
    </div>
  );
}

function ValueMetric({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "default" | "positive" | "warning";
}) {
  return (
    <div className={styles.valueMetric}>
      <span>{label}</span>
      <strong
        className={
          tone === "positive"
            ? styles.positiveText
            : tone === "warning"
              ? styles.warningText
              : undefined
        }
      >
        {value}
      </strong>
      <small>{note}</small>
    </div>
  );
}

function ProblemGridRow({ row }: { row: ProblemRow }) {
  return (
    <tr>
      <th scope="row">
        <strong>{row.title}</strong>
      </th>
      <td>{formatInteger(row.tasks)}</td>
      <td className={styles.warningText}>{formatRubles(row.valueGapRub)}</td>
      {row.cells.map((cell) => (
        <HeatCell key={cell.key} cell={cell} highlighted={row.worst === cell.key} />
      ))}
    </tr>
  );
}

function HeatCell({
  cell,
  highlighted,
}: {
  cell: ProblemCell;
  highlighted: boolean;
}) {
  const severityClass =
    cell.severity === "act"
      ? styles.heatAct
      : cell.severity === "watch"
        ? styles.heatWatch
        : styles.heatOk;

  return (
    <td
      className={[
        styles.heatCell,
        severityClass,
        highlighted ? styles.heatWorst : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // Counts belong next to the rate: 100 % of two requests is not a finding.
      title={`${cell.numerator} из ${cell.denominator}`}
    >
      {cell.denominator > 0 ? formatPercent(cell.rate) : "—"}
    </td>
  );
}

function LayerRow({
  layer,
  total,
}: {
  layer: PipelineLayer;
  total: number;
}) {
  // Extraction transforms rather than resolves, so a share of the funnel would
  // read as 0 % and imply the layer does nothing.
  const isTransform = layer.resolved === 0 && layer.id === "extract";
  const share = layer.received > 0 ? layer.resolved / layer.received : 0;

  return (
    <tr>
      <th scope="row">
        <strong>{layer.title}</strong>
        <span>
          <i style={{ width: `${(layer.received / Math.max(1, total)) * 100}%` }} />
        </span>
      </th>
      <td>{formatInteger(layer.received)}</td>
      <td>{isTransform ? "—" : formatInteger(layer.resolved)}</td>
      <td>{isTransform ? "—" : formatPercent(share)}</td>
      <td>{layer.costRub > 0 ? formatRubles(layer.costRub) : "0 ₽"}</td>
      <td className={styles.quoteCell}>{layer.note}</td>
    </tr>
  );
}

function ScenarioRow({
  scenario,
  maxRequests,
}: {
  scenario: CheckpointResponse["topScenarios"][number];
  maxRequests: number;
}) {
  const tokensPerRequest = safeRatio(scenario.tokens, scenario.requests);
  const signal =
    scenario.repeatRate >= 0.15
      ? "Проверить повторы"
      : scenario.successRate >= 0.65
        ? "Масштабировать"
        : "Наблюдать";

  return (
    <tr>
      <th scope="row">
        <strong>{scenario.title}</strong>
        <span>
          <i
            style={{
              width: `${(scenario.requests / maxRequests) * 100}%`,
            }}
          />
        </span>
      </th>
      <td>{formatInteger(scenario.requests)}</td>
      <td>{formatPercent(scenario.successRate)}</td>
      <td
        className={
          scenario.repeatRate >= 0.15 ? styles.warningText : undefined
        }
      >
        {formatPercent(scenario.repeatRate)}
      </td>
      <td>{scenario.manualMinutes} мин</td>
      <td>{formatRubles(scenario.realizedValueRub)}</td>
      <td className={styles.warningText}>
        {formatRubles(scenario.valueGapRub)}
      </td>
      <td>{formatCompact(tokensPerRequest)}</td>
      <td>
        <span
          className={
            signal === "Масштабировать"
              ? styles.goodSignal
              : signal === "Проверить повторы"
                ? styles.badSignal
                : styles.neutralSignal
          }
        >
          {signal}
        </span>
      </td>
    </tr>
  );
}

function SegmentRow({
  segment,
  maxTasks,
}: {
  segment: SegmentMetrics;
  maxTasks: number;
}) {
  return (
    <tr>
      <th scope="row">
        <strong>{segment.name}</strong>
        <span>
          <i style={{ width: `${(segment.tasks / maxTasks) * 100}%` }} />
        </span>
      </th>
      <td>{formatInteger(segment.tasks)}</td>
      <td>{formatInteger(segment.activeUsers)}</td>
      <td>{formatPercent(segment.successRate)}</td>
      <td
        className={
          segment.reworkRate >= 0.15 ? styles.warningText : undefined
        }
      >
        {formatPercent(segment.reworkRate)}
      </td>
      <td>{formatFte(segment.fteMonthsRealized)}</td>
      <td>{formatRubles(segment.realizedValueRub)}</td>
      <td
        className={
          segment.netValueRub < 0 ? styles.warningText : styles.goodSignal
        }
      >
        {formatSignedRubles(segment.netValueRub)}
      </td>
    </tr>
  );
}

function OverviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect height="6" width="6" x="2" y="2" />
      <rect height="6" width="6" x="12" y="2" />
      <rect height="6" width="6" x="2" y="12" />
      <rect height="6" width="6" x="12" y="12" />
    </svg>
  );
}

function DemandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M3 15V9M10 15V4M17 15v-8" />
    </svg>
  );
}

function ValueIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v8M7.5 8h5M7.5 12h5" />
    </svg>
  );
}

function ProblemsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect height="5" width="5" x="2" y="2" />
      <rect height="5" width="5" x="2" y="13" />
      <rect height="5" width="5" x="13" y="2" />
      <rect height="5" width="5" x="13" y="13" />
    </svg>
  );
}

function PipelineIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M2 4h16M4 8h12M6 12h8M8 16h4" />
    </svg>
  );
}

function DepartmentsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect height="7" width="6" x="2" y="11" />
      <rect height="12" width="6" x="12" y="6" />
      <path d="M2 18h16" />
    </svg>
  );
}

function EconomicsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7" />
      <path d="M12.5 7.5c-.5-.7-1.3-1-2.4-1-1.3 0-2.2.6-2.2 1.5 0 2.4 4.4.9 4.4 3.4 0 1-.9 1.7-2.4 1.7-1.1 0-2-.4-2.6-1.1M10 5v10" />
    </svg>
  );
}

function QualityIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m3 10 4 4 10-10M3 4h6M3 16h14" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect height="14" rx="2" width="16" x="2" y="4" />
      <path d="M6 2v4M14 2v4M2 8h16" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 2v11M6 9l4 4 4-4M3 17h14" />
    </svg>
  );
}

function formatMinutes(value: number) {
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 1,
  }).format(value)} мин`;
}

function formatFte(value: number) {
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)} FTE`;
}

function formatRubles(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

/** Kopecks matter when the number is a per-minute rate. */
function formatRublesPrecise(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedRubles(value: number) {
  const formatted = formatRubles(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedPercent(value: number | null) {
  if (value === null) {
    return "нет данных";
  }
  const formatted = formatPercent(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

function formatSignedPoints(value: number) {
  const points = Math.abs(value * 100).toFixed(1).replace(".", ",");
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${points} п.п.`;
}

function formatRatio(value: number | null) {
  return value === null
    ? "нет данных"
    : new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
}

function formatDuration(value: number) {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1).replace(".", ",")} c`
    : `${Math.round(value)} мс`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPeriod(period: CheckpointResponse["dataset"]["period"]) {
  if (!period.from || !period.to) {
    return "Последние 60 дней";
  }
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  return `${formatter.format(new Date(period.from))} – ${formatter.format(
    new Date(period.to),
  )}`;
}

function calculateDelta(first: number | undefined, last: number | undefined) {
  if (!first || last === undefined) {
    return 0;
  }
  return last / first - 1;
}

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}
