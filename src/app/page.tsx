import demoAnalysis from "@/data/demo-analysis.json";
import {
  analysisResultSchema,
  type ActionTag,
  type BusinessDomain,
} from "@/lib/contracts/analysis";
import Link from "next/link";

const analysis = analysisResultSchema.parse(demoAnalysis);

const actionLabels: Record<ActionTag, string> = {
  retrieve: "поиск",
  summarize: "саммари",
  analyze: "анализ",
  write: "текст",
  create: "создание",
  update: "изменение",
  export: "экспорт",
  schedule: "планирование",
  monitor: "мониторинг",
  notify: "уведомление",
  other: "другое",
};

const domainLabels: Record<BusinessDomain, string> = {
  email: "почта",
  crm_sales: "CRM / продажи",
  project_systems: "проекты",
  hr: "HR",
  calendar_meetings: "календарь",
  knowledge_base: "база знаний",
  spreadsheets_analytics: "таблицы",
  public_sources: "внешние источники",
  other: "другое",
};

function formatPercent(value: number, digits = 1) {
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDelta(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPercent(value, 0)}`;
}

export default function Home() {
  const topOpportunity = analysis.opportunities[0];
  const maxTrendRequests = Math.max(
    ...analysis.trend.map((point) => point.requests),
  );

  return (
    <div className="radar-shell">
      <header className="top-rail">
        <a className="product-mark" href="#briefing" aria-label="Prompt Radar">
          <span className="product-index">PR//01</span>
          <span className="product-name">PROMPT RADAR</span>
        </a>
        <nav className="top-nav" aria-label="Разделы">
          <Link href="/checkpoint">Экономика</Link>
          <a href="#scenarios">Сценарии</a>
          <a href="#decisions">Решения</a>
          <a href="#method">Метод</a>
        </nav>
        <div className="dataset-state">
          <span className="live-dot" aria-hidden="true" />
          DEMO / {analysis.dataset.totalRequests.toLocaleString("ru-RU")} запросов
        </div>
      </header>

      <main>
        <section className="briefing" id="briefing">
          <div className="briefing-copy">
            <p className="section-label">Оперативная сводка · 24 июля</p>
            <h1>
              ИИ используют чаще.
              <br />
              Главный резерв — <em>повторяемые процессы.</em>
            </h1>
            <p className="briefing-summary">
              За пять недель объём запросов вырос, а доля проблем снизилась.
              Радар нашёл {analysis.overview.automationCandidates} сценариев,
              которые выгоднее превратить в управляемые workflow.
            </p>
          </div>

          <aside className="decision-callout" aria-label="Решение недели">
            <div className="decision-number">01</div>
            <div>
              <p className="section-label">Решение недели</p>
              <h2>{topOpportunity.title}</h2>
              <p>{topOpportunity.recommendation}</p>
              <div className="callout-meta">
                <span>Impact {topOpportunity.impactScore}/100</span>
                <span>{topOpportunity.requestCount} запросов</span>
              </div>
            </div>
          </aside>
        </section>

        <section className="metric-strip" aria-label="Ключевые показатели">
          <div className="metric">
            <span className="metric-label">Запросов</span>
            <strong>
              {analysis.dataset.totalRequests.toLocaleString("ru-RU")}
            </strong>
            <span className="metric-note">за 5 недель</span>
          </div>
          <div className="metric">
            <span className="metric-label">Сценариев</span>
            <strong>{analysis.overview.activeScenarios}</strong>
            <span className="metric-note">
              unknown {formatPercent(analysis.overview.unknownRate)}
            </span>
          </div>
          <div className="metric metric-alert">
            <span className="metric-label">Проблемных</span>
            <strong>{formatPercent(analysis.overview.problemRate)}</strong>
            <span className="metric-note">ошибки и повторные запросы</span>
          </div>
          <div className="metric">
            <span className="metric-label">Сжатие входа</span>
            <strong>×{analysis.overview.tokenReductionFactor}</strong>
            <span className="metric-note">Intent Capsule</span>
          </div>
        </section>

        <section className="content-grid">
          <article className="panel trend-panel">
            <header className="panel-heading">
              <div>
                <p className="section-label">Динамика</p>
                <h2>Использование растёт, трение снижается</h2>
              </div>
              <span className="period">20 июн — 24 июл</span>
            </header>
            <div className="trend-chart" aria-label="Динамика запросов по неделям">
              {analysis.trend.map((point) => (
                <div className="trend-column" key={point.date}>
                  <span className="trend-value">{point.requests}</span>
                  <div className="trend-track">
                    <span
                      className="trend-fill"
                      style={{
                        height: `${(point.requests / maxTrendRequests) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="trend-date">{point.date}</span>
                  <span className="trend-problem">
                    {formatPercent(point.problemRate, 0)} проблем
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel method-glance">
            <p className="section-label">Качество метода</p>
            <div className="method-score">
              <strong>{analysis.methodology.macroF1.toFixed(2)}</strong>
              <span>Macro-F1</span>
            </div>
            <dl>
              <div>
                <dt>Чистота кластеров</dt>
                <dd>{formatPercent(analysis.methodology.clusterPurity, 0)}</dd>
              </div>
              <div>
                <dt>LLM-вызовов</dt>
                <dd>
                  {analysis.methodology.llmCalls} /{" "}
                  {analysis.methodology.llmEveryPromptBaselineCalls}
                </dd>
              </div>
              <div>
                <dt>Локальный путь</dt>
                <dd>
                  {formatPercent(analysis.overview.localProcessingRate, 0)}
                </dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="scenario-section" id="scenarios">
          <header className="section-heading">
            <div>
              <p className="section-label">01 / Карта спроса</p>
              <h2>Какие процессы сотрудники уже отдают агентам</h2>
            </div>
            <p>
              Категория показывает действие и систему. Сценарий — конкретный
              устойчивый способ применения.
            </p>
          </header>

          <div className="scenario-table" role="table">
            <div className="scenario-header" role="row">
              <span>Сценарий</span>
              <span>Тип</span>
              <span>Объём</span>
              <span>Рост</span>
              <span>Проблемы</span>
            </div>
            {analysis.scenarios.map((scenario, index) => (
              <article className="scenario-row" role="row" key={scenario.id}>
                <div className="scenario-title-cell">
                  <span className="row-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{scenario.title}</h3>
                    <p>{scenario.summary}</p>
                  </div>
                </div>
                <div className="scenario-tags">
                  <span>{actionLabels[scenario.action]}</span>
                  <span>{domainLabels[scenario.domain]}</span>
                </div>
                <div className="scenario-volume">
                  <strong>{scenario.requestCount}</strong>
                  <span className="share-track">
                    <span style={{ width: `${scenario.share * 100}%` }} />
                  </span>
                </div>
                <strong className="positive">
                  {formatDelta(scenario.growthRate)}
                </strong>
                <strong
                  className={
                    scenario.problemRate >= 0.18 ? "negative" : undefined
                  }
                >
                  {formatPercent(scenario.problemRate)}
                </strong>
              </article>
            ))}
          </div>
        </section>

        <section className="decision-section" id="decisions">
          <header className="section-heading">
            <div>
              <p className="section-label">02 / Очередь улучшений</p>
              <h2>Что делать дальше</h2>
            </div>
            <p>
              Приоритет учитывает объём, рост, повторяемость и подтверждённые
              проблемы. Каждая рекомендация опирается на наблюдаемые сигналы.
            </p>
          </header>

          <div className="decision-list">
            {analysis.opportunities.map((opportunity) => (
              <article className="decision-row" key={opportunity.id}>
                <span className="decision-rank">
                  {String(opportunity.rank).padStart(2, "0")}
                </span>
                <div className="decision-main">
                  <div className="decision-type">
                    {opportunity.recommendationType.replace("_", " ")}
                  </div>
                  <h3>{opportunity.title}</h3>
                  <p>{opportunity.recommendation}</p>
                </div>
                <ul>
                  {opportunity.evidence.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="impact-score">
                  <strong>{opportunity.impactScore}</strong>
                  <span>impact</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="workflow-section">
          <header className="section-heading compact">
            <div>
              <p className="section-label">03 / Контуры интеграций</p>
              <h2>Между какими системами движется работа</h2>
            </div>
          </header>
          <div className="workflow-list">
            {analysis.workflow.map((edge) => (
              <div
                className="workflow-edge"
                key={`${edge.source}-${edge.target}`}
              >
                <span>{edge.source}</span>
                <div className="edge-line" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.max(18, edge.problemRate * 100)}%`,
                    }}
                  />
                </div>
                <span>{edge.target}</span>
                <strong>{edge.requestCount}</strong>
              </div>
            ))}
          </div>
        </section>

        <footer className="method-footer" id="method">
          <div>
            <p className="section-label">Метод</p>
            <h2>{analysis.methodology.classifier}</h2>
          </div>
          <p>
            Полный контекст остаётся у пользователя. Короткая Intent Capsule
            классифицируется по прототипам; неизвестные запросы группируются
            через {analysis.methodology.clusterer}. LLM называет только готовые
            группы.
          </p>
          <span className="footer-index">MEPHI / CROC / 2026</span>
        </footer>
      </main>
    </div>
  );
}
