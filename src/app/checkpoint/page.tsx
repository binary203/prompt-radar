"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

type CheckpointResponse = {
  generatedAt: string;
  dataset: {
    events: number;
    uniqueIntentSeeds: number;
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
  economics: {
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
  };
  evaluation: {
    evaluated: number;
    scenarioTop1Accuracy: number;
    actionAccuracy: number;
    domainAccuracy: number;
    predictedUnknownRate: number;
  };
  agents: Record<string, AgentMetrics>;
  trend: TrendPoint[];
  topScenarios: Array<{
    id: string;
    title: string;
    requests: number;
    successRate: number;
    repeatRate: number;
    tokens: number;
  }>;
  intentExtractionDemo: {
    sourceChars: number;
    extracted: string;
    expectedRouting: string;
  };
  disclaimer: string;
};

const bands = ["low", "base", "high"] as const;

export default function CheckpointPage() {
  const [data, setData] = useState<CheckpointResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/checkpoint", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<CheckpointResponse>;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== "AbortError") {
          setError(reason.message);
        }
      });

    return () => controller.abort();
  }, []);

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!data) {
    return <LoadingState />;
  }

  const platform = data.agents.agent_platform;
  const web = data.agents.web_chat;
  const netValue =
    data.economics.realizedValueRub.base - data.economics.tcoRub.total;
  const costPerSuccess =
    data.usage.successes > 0
      ? data.economics.tcoRub.total / data.usage.successes
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
            Синтетические данные
            <span className={styles.topbarDivider} />
            Обновлено {formatTime(data.generatedAt)}
          </div>
        </header>

        <main className={styles.main}>
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
              <Link className={styles.ghostButton} href="/api/checkpoint">
                JSON
              </Link>
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

          <div className={styles.demoNotice}>
            <strong>DEMO DATA</strong>
            <span>
              Финансовые значения рассчитаны на воспроизводимой синтетике.
              Боевой ROI требует калибровки коэффициентов КРОК.
            </span>
          </div>

          <section className={styles.kpiStrip} aria-label="Ключевые показатели">
            <Kpi
              label="Запросы"
              value={formatInteger(data.dataset.events)}
              note={`${formatSignedPercent(requestDelta)} к первой неделе`}
            />
            <Kpi
              label="Активные пользователи"
              value={formatInteger(data.dataset.activeUsers)}
              note={`MAU ${Math.round(data.dataset.mau)}`}
            />
            <Kpi
              label="Успешные outcome"
              value={formatPercent(data.usage.successRate)}
              note={`${formatSignedPoints(successDelta)} за период`}
              tone="positive"
            />
            <Kpi
              label="Повторные запросы"
              value={formatPercent(data.usage.repeatRate)}
              note={`${formatInteger(data.usage.repeats)} повторов`}
              tone="warning"
            />
            <Kpi
              label="Затраты на успешный результат"
              value={formatRubles(costPerSuccess)}
              note="TCO / success, это не экономия"
            />
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
              subtitle="Base case, 60-дневная аллокация TCO"
            >
              <div className={styles.economicSummary}>
                <span>
                  ROI <strong>{formatSignedPercent(data.economics.roi.base)}</strong>
                </span>
                <span>
                  Возврат / 1 ₽{" "}
                  <strong>
                    {formatRatio(data.economics.returnPerRuble.base)} ₽
                  </strong>
                </span>
                <span>
                  Net value <strong>{formatSignedRubles(netValue)}</strong>
                </span>
              </div>
            </PanelHeader>

            <div className={styles.economicsGrid}>
              <ValueBreakdown data={data} />

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
                    {bands.map((band) => (
                      <tr
                        className={
                          band === "base" ? styles.selectedRow : undefined
                        }
                        key={band}
                      >
                        <th scope="row">{band.toUpperCase()}</th>
                        <td>
                          {formatRubles(
                            data.economics.realizedValueRub[band],
                          )}
                        </td>
                        <td>
                          {formatSignedPercent(data.economics.roi[band])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Manual time: 30 / 45 / 65 минут. Review tax и outcome
                  учитываются отдельно для каждого сценария оценки.
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
              <AgentComparison
                agents={[
                  ["Web chat", web],
                  ["Agent platform", platform],
                ]}
              />
            </article>

            <article className={styles.panel} id="quality">
              <PanelHeader
                title="Качество классификации"
                subtitle={`${data.evaluation.evaluated} уникальных intent`}
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
              <div className={styles.intentEvidence}>
                <span>
                  Intent extracted from{" "}
                  {formatInteger(data.intentExtractionDemo.sourceChars)} chars
                </span>
                <strong>“{data.intentExtractionDemo.extracted}”</strong>
                <small>{data.intentExtractionDemo.expectedRouting}</small>
              </div>
            </article>
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
        <a href="#scenarios">
          <DemandIcon />
          Сценарии
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
          Synthetic log
        </strong>
        <small>1 500 events · 60 days</small>
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

function ValueBreakdown({ data }: { data: CheckpointResponse }) {
  const potential = data.economics.potentialValueRub.base;
  const rows = [
    {
      label: "Potential value",
      value: potential,
      className: styles.valuePotential,
    },
    {
      label: "Realized value",
      value: data.economics.realizedValueRub.base,
      className: styles.valueRealized,
    },
    {
      label: "TCO",
      value: data.economics.tcoRub.total,
      className: styles.valueTco,
    },
    {
      label: "Value gap",
      value: data.economics.valueGapRub.base,
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

function formatRubles(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
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
