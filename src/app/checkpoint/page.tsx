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

type CheckpointResponse = {
  dataset: {
    events: number;
    uniqueIntentSeeds: number;
    periodDays: number;
    activeUsers: number;
    mau: number;
  };
  usage: {
    toolCalls: number;
    tokens: number;
    successes: number;
    partials: number;
    errors: number;
    repeats: number;
    successRate: number;
    repeatRate: number;
  };
  economics: {
    potentialValueRub: Band;
    realizedValueRub: Band;
    valueGapRub: Band;
    tcoRub: { total: number };
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
    return (
      <main className={styles.state}>
        <span>CHECKPOINT / ERROR</span>
        <h1>Расчёт не завершён</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.state}>
        <span>CHECKPOINT / ANALYSIS</span>
        <h1>Собираем картину ценности</h1>
        <p>Intent → scenario → outcome → economics</p>
      </main>
    );
  }

  const platform = data.agents.agent_platform;
  const web = data.agents.web_chat;
  const tokenRatio =
    platform && web
      ? platform.totalTokens /
        platform.requests /
        (web.totalTokens / web.requests)
      : 0;
  const outcomeYield =
    data.economics.realizedValueRub.base /
    data.economics.potentialValueRub.base;
  const netValue =
    data.economics.realizedValueRub.base - data.economics.tcoRub.total;
  const costPerSuccess =
    data.usage.successes > 0
      ? data.economics.tcoRub.total / data.usage.successes
      : 0;

  return (
    <main className={styles.shell}>
      <header className={styles.rail}>
        <Link className={styles.wordmark} href="/">
          PROMPT RADAR
        </Link>
        <div className={styles.railStatus}>
          <span className={styles.liveDot} aria-hidden="true" />
          SYNTHETIC RUN
        </div>
        <span className={styles.railMeta}>
          {data.dataset.periodDays} DAYS / {formatInteger(data.dataset.events)}{" "}
          EVENTS
        </span>
      </header>

      <section className={styles.opening}>
        <div className={styles.openingCopy}>
          <p className={styles.kicker}>Executive checkpoint</p>
          <h1>
            Токены показывают расходы.
            <br />
            <span>Outcome показывает ценность.</span>
          </h1>
          <p className={styles.lead}>
            Prompt Radar извлекает намерение из OpenAI-compatible payload,
            связывает его с бизнес-сценарием и проверяет результат по traces,
            повторам и feedback.
          </p>
        </div>
        <div className={styles.baseVerdict}>
          <span>BASE / PROXY MODEL</span>
          <strong>
            {formatRatio(data.economics.returnPerRuble.base)}
            <small> ₽</small>
          </strong>
          <p>реализованной ценности на 1 ₽ полной стоимости</p>
          <dl>
            <div>
              <dt>ROI</dt>
              <dd>{formatSignedPercent(data.economics.roi.base)}</dd>
            </div>
            <div>
              <dt>Net value</dt>
              <dd>{formatSignedRubles(netValue)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.ledger} aria-labelledby="value-ledger">
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.kicker}>Value ledger</p>
            <h2 id="value-ledger">Как активность превращается в результат</h2>
          </div>
          <p>
            Синтетический прогон. Финансовые коэффициенты доступны как
            low / base / high и требуют калибровки на реальных логах.
          </p>
        </header>

        <div className={styles.equation}>
          <LedgerTerm
            label="Potential"
            value={formatRubles(data.economics.potentialValueRub.base)}
            note="все задачи завершены"
          />
          <span className={styles.operator}>×</span>
          <LedgerTerm
            label="Outcome yield"
            value={formatPercent(outcomeYield)}
            note="подтверждённая доля"
            warning
          />
          <span className={styles.operator}>=</span>
          <LedgerTerm
            label="Realized"
            value={formatRubles(data.economics.realizedValueRub.base)}
            note="полученный результат"
            accent
          />
          <span className={styles.operator}>−</span>
          <LedgerTerm
            label="TCO"
            value={formatRubles(data.economics.tcoRub.total)}
            note="модель + люди + infra"
          />
        </div>

        <div className={styles.ledgerFoot}>
          <span>Value Gap</span>
          <strong>{formatRubles(data.economics.valueGapRub.base)}</strong>
          <p>
            Потенциал, который потерян на ошибках, повторах и проверке человеком.
          </p>
        </div>
      </section>

      <dl className={styles.telemetry} aria-label="Метрики использования">
        <Telemetry label="MAU" value={Math.round(data.dataset.mau).toString()} />
        <Telemetry
          label="Requests"
          value={formatInteger(data.dataset.events)}
        />
        <Telemetry
          label="Tool calls"
          value={formatInteger(data.usage.toolCalls)}
        />
        <Telemetry label="Tokens" value={formatCompact(data.usage.tokens)} />
        <Telemetry
          label="Success"
          value={formatPercent(data.usage.successRate)}
        />
        <Telemetry
          label="Cost / success"
          value={formatRubles(costPerSuccess)}
        />
      </dl>

      <div className={styles.analysisGrid}>
        <section className={styles.analysisSection}>
          <header className={styles.sectionHead}>
            <div>
              <p className={styles.kicker}>Sensitivity</p>
              <h2>Не одна красивая цифра, а диапазон</h2>
            </div>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Допущение</th>
                  <th>Realized</th>
                  <th>ROI</th>
                  <th>Возврат / ₽</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((band) => (
                  <tr
                    className={band === "base" ? styles.activeRow : undefined}
                    key={band}
                  >
                    <th scope="row">{band.toUpperCase()}</th>
                    <td>
                      {formatRubles(data.economics.realizedValueRub[band])}
                    </td>
                    <td>{formatSignedPercent(data.economics.roi[band])}</td>
                    <td>{formatRatio(data.economics.returnPerRuble[band])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.analysisSection}>
          <header className={styles.sectionHead}>
            <div>
              <p className={styles.kicker}>Agent tax</p>
              <h2>Больше действий — не значит больше пользы</h2>
            </div>
          </header>
          <div className={styles.agentRows}>
            <AgentRow name="Web chat" metrics={web} />
            <AgentRow name="Agent platform" metrics={platform} />
          </div>
          <p className={styles.finding}>
            Agent Platform тратит <strong>{tokenRatio.toFixed(1)}×</strong>{" "}
            больше токенов на запрос. Поэтому сравниваем не tool calls, а
            стоимость успешного outcome.
          </p>
        </section>
      </div>

      <section className={styles.scenarios}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.kicker}>Demand map</p>
            <h2>Сценарии, ставшие рабочими процессами</h2>
          </div>
          <p>
            Дешёвый baseline даёт{" "}
            <strong>
              {formatPercent(data.evaluation.scenarioTop1Accuracy)}
            </strong>{" "}
            top-1 на {data.evaluation.evaluated} уникальных intent. Только
            неуверенные запросы уходят в локальную модель.
          </p>
        </header>
        <div className={styles.tableWrap}>
          <table className={`${styles.dataTable} ${styles.scenarioTable}`}>
            <thead>
              <tr>
                <th>Бизнес-сценарий</th>
                <th>Запросы</th>
                <th>Success</th>
                <th>Repeat</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.topScenarios.map((scenario) => (
                <tr key={scenario.id}>
                  <th scope="row">{scenario.title}</th>
                  <td>{scenario.requests}</td>
                  <td>{formatPercent(scenario.successRate)}</td>
                  <td>{formatPercent(scenario.repeatRate)}</td>
                  <td>{formatCompact(scenario.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.proof}>
        <div>
          <p className={styles.kicker}>Intent isolation proof</p>
          <h2>Не классифицируем весь RAG-контекст</h2>
        </div>
        <div className={styles.payload}>
          <span>
            SOURCE / {formatInteger(data.intentExtractionDemo.sourceChars)} CHARS
          </span>
          <strong>“{data.intentExtractionDemo.extracted}”</strong>
          <span>ROUTING / {data.intentExtractionDemo.expectedRouting}</span>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>MEPHI × CROC / 2026</span>
        <p>{data.disclaimer}</p>
        <Link href="/api/checkpoint">RAW JSON ↗</Link>
      </footer>
    </main>
  );
}

function LedgerTerm({
  label,
  value,
  note,
  accent = false,
  warning = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
  warning?: boolean;
}) {
  const className = accent
    ? styles.ledgerTermAccent
    : warning
      ? styles.ledgerTermWarning
      : styles.ledgerTerm;

  return (
    <div className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}

function Telemetry({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AgentRow({
  name,
  metrics,
}: {
  name: string;
  metrics: AgentMetrics | undefined;
}) {
  if (!metrics) {
    return null;
  }

  const tokensPerRequest =
    metrics.requests > 0 ? metrics.totalTokens / metrics.requests : 0;

  return (
    <div className={styles.agentRow}>
      <strong>{name}</strong>
      <dl>
        <div>
          <dt>Users</dt>
          <dd>{metrics.activeUsers}</dd>
        </div>
        <div>
          <dt>Requests</dt>
          <dd>{metrics.requests}</dd>
        </div>
        <div>
          <dt>Tokens / req</dt>
          <dd>{formatCompact(tokensPerRequest)}</dd>
        </div>
        <div>
          <dt>Repeat</dt>
          <dd>{formatPercent(metrics.repeatRate)}</dd>
        </div>
      </dl>
    </div>
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
  const formatted = formatPercent(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatRatio(value: number | null) {
  return value === null
    ? "нет данных"
    : new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
}
