import type { Content } from "@/lib/contract";
import { kst } from "@/lib/calendar";
export function Chart({
  chart,
  content,
}: {
  chart: Content["charts"][number];
  content: Content;
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
  const min = Math.min(...values) - 0.4,
    max = Math.max(...values) + 0.4;
  return (
    <figure
      className="chart"
      id={`chart-${chart.id}`}
      aria-labelledby={`${chart.id}-title`}
    >
      <figcaption>
        <strong id={`${chart.id}-title`}>{chart.title}</strong>
        <span>
          {chart.period} · {chart.unit}
        </span>
      </figcaption>
      {chart.kind === "line" ? (
        <svg
          className="line-chart"
          viewBox="0 0 640 230"
          role="img"
          aria-label={chart.alt}
        >
          <defs>
            <linearGradient id={`fill-${chart.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--data)" stopOpacity=".12" />
              <stop offset="100%" stopColor="var(--data)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line
                x1="50"
                y1={25 + i * 52}
                x2="620"
                y2={25 + i * 52}
                stroke="var(--line)"
                strokeDasharray="3 6"
              />
              <text x="0" y={30 + i * 52} fill="var(--muted)" fontSize="14">
                {(max - ((max - min) * i) / 3).toFixed(1)}
              </text>
            </g>
          ))}
          <path
            d={`M 55 185 ${points.map((p, i) => `L ${55 + (i * 555) / Math.max(1, points.length - 1)} ${25 + ((max - p.observation.value) / (max - min)) * 156}`).join(" ")} L 610 185 Z`}
            fill={`url(#fill-${chart.id})`}
          />
          <polyline
            fill="none"
            stroke="var(--data)"
            strokeWidth="3"
            points={points
              .map(
                (p, i) =>
                  `${55 + (i * 555) / Math.max(1, points.length - 1)},${25 + ((max - p.observation.value) / (max - min)) * 156}`,
              )
              .join(" ")}
          />
          {points.map((p, i) => (
            <g key={p.observationId}>
              <circle
                cx={55 + (i * 555) / Math.max(1, points.length - 1)}
                cy={25 + ((max - p.observation.value) / (max - min)) * 156}
                r="4"
                fill="var(--data)"
              />
              <text
                x={55 + (i * 555) / Math.max(1, points.length - 1)}
                y="217"
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="14"
              >
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <div className="bar-chart">
          {points.map((p) => (
            <div className="bar-row" key={p.observationId}>
              <span>{p.label}</span>
              <div className="bar-track">
                <div
                  className={
                    p.observation.value >= 0 ? "bar positive" : "bar negative"
                  }
                  style={{
                    width: `${(Math.abs(p.observation.value) / Math.max(...values.map(Math.abs), 1)) * 90}%`,
                  }}
                />
              </div>
              <strong className={p.observation.value >= 0 ? "up" : "down"}>
                {p.observation.value > 0 ? "+" : ""}
                {p.observation.value.toFixed(1)}%
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
      <p className="source-links">
        자료 기준 {kst(content.bundle.cutoffAt)} KST · 출처{" "}
        {chart.sourceIds.map((id) => (
          <a key={id} href={`#source-${id}`}>
            {content.bundle.sources.find((s) => s.id === id)?.publisher}
          </a>
        ))}
      </p>
      <details>
        <summary>값 표로 확인하기</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>대상</th>
                <th>구간</th>
                <th>값 ({chart.unit})</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.observationId}>
                  <th>{p.series}</th>
                  <td>{p.label}</td>
                  <td>{p.observation.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
