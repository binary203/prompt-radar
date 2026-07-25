"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
        <h1>Не удалось посчитать демонстрационный прогон.</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.state}>
        <span>CHECKPOINT / ANALYSIS</span>
        <h1>Обрабатываем 1 500 событий…</h1>
        <p>Intent extraction → classification → economics</p>
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

  return (
    <main className={styles.shell}>
      <header className={styles.rail}>
        <Link href="/">PR//01 · PROMPT RADAR</Link>
        <span>CHECKPOINT / SYNTHETIC RUN</span>
        <span>60 DAYS · {formatInteger(data.dataset.events)} EVENTS</span>
      </header>

      <section className={styles.briefing}>
        <div>
          <p className={styles.eyebrow}>Главный ответ CTO</p>
          <h1>
            Один рубль затрат
            <br />
            возвращает{" "}
            <em>{formatRatio(data.economics.returnPerRuble.base)} ₽</em>
          </h1>
          <p className={styles.lead}>
            Не считаем tool calls пользой. Связываем выполненный бизнес-сценарий
            с ручным временем, outcome и полной стоимостью владения.
          </p>
        </div>
        <div className={styles.verdict}>
          <span>BASE CASE</span>
          <strong>{formatSignedPercent(data.economics.roi.base)}</strong>
          <p>ROI при открытых настраиваемых допущениях</p>
        </div>
      </section>

      <section className={styles.valueFlow} aria-label="Воронка ценности">
        <FlowStep
          index="01"
          label="Potential Value"
          value={formatRubles(data.economics.potentialValueRub.base)}
          note="если все задачи завершены"
        />
        <span className={styles.flowArrow}>→</span>
        <FlowStep
          index="02"
          label="Realized Value"
          value={formatRubles(data.economics.realizedValueRub.base)}
          note={`${formatPercent(data.usage.successRate)} успешных outcome`}
          accent
        />
        <span className={styles.flowArrow}>−</span>
        <FlowStep
          index="03"
          label="TCO"
          value={formatRubles(data.economics.tcoRub.total)}
          note="инференс + команда + инфраструктура"
        />
      </section>

      <section className={styles.metricStrip}>
        <Metric label="MAU" value={Math.round(data.dataset.mau).toString()} />
        <Metric label="Tool calls" value={formatInteger(data.usage.toolCalls)} />
        <Metric label="Tokens" value={formatCompact(data.usage.tokens)} />
        <Metric
          label="FTE-months"
          value={data.economics.fteMonthsRealized.base.toFixed(2)}
        />
        <Metric
          label="Value Gap"
          value={formatRubles(data.economics.valueGapRub.base)}
          warning
        />
      </section>

      <section className={styles.split}>
        <article className={styles.bandPanel}>
          <header>
            <p className={styles.eyebrow}>Sensitivity</p>
            <h2>Честный диапазон вместо одной «магической» цифры</h2>
          </header>
          <div className={styles.bandTable}>
            <div className={styles.bandHeader}>
              <span>Сценарий</span>
              <span>Realized</span>
              <span>ROI</span>
              <span>₽ / 1 ₽</span>
            </div>
            {bands.map((band) => (
              <div
                className={band === "base" ? styles.baseBand : undefined}
                key={band}
              >
                <strong>{band.toUpperCase()}</strong>
                <span>{formatRubles(data.economics.realizedValueRub[band])}</span>
                <span>{formatSignedPercent(data.economics.roi[band])}</span>
                <span>{formatRatio(data.economics.returnPerRuble[band])}</span>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.agentPanel}>
          <header>
            <p className={styles.eyebrow}>Agent tax</p>
            <h2>Агентская платформа дороже, но насколько полезнее?</h2>
          </header>
          <div className={styles.agentCompare}>
            <AgentColumn name="WEB CHAT" metrics={web} />
            <AgentColumn name="AGENT PLATFORM" metrics={platform} />
          </div>
          <p className={styles.insight}>
            Agent Platform расходует в <strong>{tokenRatio.toFixed(1)}×</strong>{" "}
            больше токенов на запрос. Следующий вопрос не «сколько tool calls»,
            а «какова стоимость успешного outcome».
          </p>
        </article>
      </section>

      <section className={styles.scenarios}>
        <header>
          <div>
            <p className={styles.eyebrow}>Demand map</p>
            <h2>Сценарии, которые уже стали рабочими процессами</h2>
          </div>
          <p>
            Baseline без LLM:{" "}
            <strong>
              {formatPercent(data.evaluation.scenarioTop1Accuracy)}
            </strong>{" "}
            top-1 на {data.evaluation.evaluated} уникальных intent. Неуверенные
            запросы уходят в локальную модель.
          </p>
        </header>
        <div className={styles.scenarioRows}>
          <div className={styles.scenarioHeader}>
            <span>Сценарий</span>
            <span>Запросы</span>
            <span>Success</span>
            <span>Repeat</span>
            <span>Tokens</span>
          </div>
          {data.topScenarios.map((scenario, index) => (
            <div className={styles.scenarioRow} key={scenario.id}>
              <span>
                <i>{String(index + 1).padStart(2, "0")}</i>
                {scenario.title}
              </span>
              <strong>{scenario.requests}</strong>
              <span>{formatPercent(scenario.successRate)}</span>
              <span>{formatPercent(scenario.repeatRate)}</span>
              <span>{formatCompact(scenario.tokens)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.proof}>
        <p className={styles.eyebrow}>Intent isolation proof</p>
        <span>RAG payload / {data.intentExtractionDemo.sourceChars} chars</span>
        <strong>“{data.intentExtractionDemo.extracted}”</strong>
        <span>{data.intentExtractionDemo.expectedRouting}</span>
      </section>

      <footer className={styles.footer}>
        <span>MEPHI · CROC · 2026</span>
        <p>{data.disclaimer}</p>
      </footer>
    </main>
  );
}

function FlowStep({
  index,
  label,
  value,
  note,
  accent = false,
}: {
  index: string;
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? styles.flowStepAccent : styles.flowStep}>
      <span>{index} / {label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className={warning ? styles.metricWarning : styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AgentColumn({
  name,
  metrics,
}: {
  name: string;
  metrics: AgentMetrics | undefined;
}) {
  if (!metrics) {
    return null;
  }

  return (
    <dl>
      <dt>{name}</dt>
      <div>
        <span>users</span>
        <strong>{metrics.activeUsers}</strong>
      </div>
      <div>
        <span>requests</span>
        <strong>{metrics.requests}</strong>
      </div>
      <div>
        <span>tokens</span>
        <strong>{formatCompact(metrics.totalTokens)}</strong>
      </div>
      <div>
        <span>repeat</span>
        <strong>{formatPercent(metrics.repeatRate)}</strong>
      </div>
    </dl>
  );
}

function formatRubles(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
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
  return value === null ? "нет данных" : value.toFixed(2);
}
