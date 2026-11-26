import type { Content } from "@/lib/contract";
import "./chart.css";
import { formatMarketTime, formatSourceTime } from "@/lib/report-time";
import { SourceReferences } from "@/components/source-references";
export function Chart({
  chart,
  content,
  referenceId,
}: {
  chart: Content["charts"][number];
  content: Content;
  referenceId: string;
}) {
  const points = chart.series.flatMap((s) =>
    s.points.map((p) => ({
      ...p,
      series: s.name,
      observation: content.bundle.observations.find(
        (o) => o.id === p.observationId,
      )!,
    })),
  );
  const values = points.map((p) => p.observation.value);
  const observedTimes = new Set(
    points.map(({ observation }) =>
      formatSourceTime(
        observation.observedAt,
        observation.observedOriginalTime,
      ),
    ),
  );
  const barExtent = Math.max(...values.map(Math.abs), 1);
  const min = Math.min(...values) - 0.4,
    max = Math.max(...values) + 0.4;
  const ticks = [0, 1, 2, 3].map((i) =>
    (max - ((max - min) * i) / 3).toFixed(1),
  );
  const plot = points.map((p, i) => ({
    x: ((i + 0.5) / points.length) * 100,
    y: ((max - p.observation.value) / (max - min)) * 100,
  }));
  return (
    <figure
      className="chart report-chart"
      id={`chart-${chart.id}`}
      aria-labelledby={`${chart.id}-title`}
    >
      <figcaption>
        <h3 id={`${chart.id}-title`}>{chart.title}</h3>
        <span className="unit">
          {chart.period} · {chart.unit}
        </span>
      </figcaption>
      {chart.kind === "line" ? (
        <div className="line-chart" role="img" aria-label={chart.alt}>
          <div
            className="chart-y-axis"
            aria-hidden="true"
            style={{
              width: `${Math.max(...ticks.map((tick) => tick.length))}ch`,
            }}
          >
            {ticks.map((tick, i) => (
              <span key={i} style={{ top: `${(i / 3) * 100}%` }}>
                {tick}
              </span>
            ))}
          </div>
          <div className="chart-plot" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient
                  id={`fill-${chart.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="var(--data)" stopOpacity=".12" />
                  <stop offset="100%" stopColor="var(--data)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3].map((i) => (
                <line
                  key={i}
                  x1="0"
                  y1={(i / 3) * 100}
                  x2="100"
                  y2={(i / 3) * 100}
                  stroke="var(--line)"
                  strokeDasharray="3 6"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path
                d={`M ${plot[0].x} 100 ${plot.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${plot[plot.length - 1].x} 100 Z`}
                fill={`url(#fill-${chart.id})`}
              />
              <polyline
                fill="none"
                stroke="var(--data)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
                points={plot.map((p) => `${p.x},${p.y}`).join(" ")}
              />
            </svg>
            {plot.map((p, i) => (
              <span
                key={i}
                className="chart-dot"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              />
            ))}
          </div>
          <div
            className="chart-x-axis"
            aria-hidden="true"
            style={{
              gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
            }}
          >
            {points.map((p) => (
              <span key={p.observationId}>{p.label}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="bar-chart">
          <div className="bar-axis" aria-hidden="true">
            <span>0</span>
          </div>
          {points.map((p) => (
            <div className="bar-row" key={p.observationId}>
              <span>{p.label}</span>
              <div className="bar-track" aria-hidden="true">
                <div
                  className={
                    p.observation.value >= 0 ? "bar positive" : "bar negative"
                  }
                  style={{
                    width: `${(Math.abs(p.observation.value) / barExtent) * 46}%`,
                  }}
                />
              </div>
              <strong
                className={
                  p.observation.value > 0
                    ? "up"
                    : p.observation.value < 0
                      ? "down"
                      : undefined
                }
              >
                {p.observation.value > 0 ? "+" : ""}
                {p.observation.value.toFixed(1)}
                {chart.unit}
              </strong>
            </div>
          ))}
        </div>
      )}
      <p className="chart-note">
        {chart.basis}
        <br />
        {chart.alt}
      </p>
      <p className="chart-cutoff">
        {observedTimes.size === 1 && (
          <>
            관측 시각 {observedTimes.values().next().value}
            <br />
          </>
        )}
        자료 기준 {formatMarketTime(content.bundle.cutoffAt)}
        <SourceReferences
          sourceIds={chart.sourceIds}
          content={content}
          referenceId={referenceId}
        />
      </p>
      <details>
        <summary>값 표로 확인하기</summary>
        <div
          className="table-scroll"
          role="region"
          aria-label={`${chart.title} 값 표`}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>대상</th>
                <th>구간</th>
                <th>값 ({chart.unit})</th>
                <th>관측 시각</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.observationId}>
                  <th>{p.series}</th>
                  <td>{p.label}</td>
                  <td>{p.observation.value}</td>
                  <td>
                    {formatSourceTime(
                      p.observation.observedAt,
                      p.observation.observedOriginalTime,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
