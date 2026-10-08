export type ScorePoint = { label: string; score: number; detail?: string };

/** Percentage chart shared by the student and organization insights. */
export function ScoreTrend({
  points,
  compact = false,
  label,
}: {
  points: ScorePoint[];
  compact?: boolean;
  label: string;
}) {
  const width = compact ? 260 : 600;
  const height = compact ? 170 : 220;
  const left = compact ? 32 : 40;
  const right = width - (compact ? 16 : 24);
  const top = 26;
  const bottom = height - 30;
  const x = (index: number) =>
    points.length === 1
      ? (left + right) / 2
      : left +
        16 +
        (index * (right - left - 28)) / Math.max(1, points.length - 1);
  const y = (score: number) =>
    bottom - (Math.max(0, Math.min(100, score)) / 100) * (bottom - top);
  const line = points
    .map((point, index) => `${x(index)},${y(point.score)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}. ${points.map((point) => `${point.detail || point.label}: ${point.score}%`).join("; ")}`}
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        overflow: "visible",
      }}
    >
      {[0, 50, 100].map((score) => (
        <g key={score}>
          <line
            x1={left}
            x2={right}
            y1={y(score)}
            y2={y(score)}
            stroke="#e3e9f1"
            strokeDasharray={score === 0 ? undefined : "3 4"}
          />
          <text
            x={left - 8}
            y={y(score) + 4}
            textAnchor="end"
            fill="#617084"
            fontSize={compact ? 10 : 12}
          >
            {score}
          </text>
        </g>
      ))}
      {points.length > 1 && (
        <>
          <polygon
            points={`${x(0)},${bottom} ${line} ${x(points.length - 1)},${bottom}`}
            fill="#edf3fb"
          />
          <polyline
            points={line}
            stroke="#315f98"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </>
      )}
      {points.map((point, index) => (
        <g key={`${point.label}:${index}`}>
          <title>
            {point.detail || point.label}: {point.score}%
          </title>
          <circle
            cx={x(index)}
            cy={y(point.score)}
            r={compact ? 4 : 5}
            fill="#315f98"
            stroke="white"
            strokeWidth="2"
          />
          <text
            x={x(index)}
            y={y(point.score) - 12}
            textAnchor="middle"
            fill="#315f98"
            fontSize={compact ? 10 : 12}
            fontWeight="700"
          >
            {point.score}%
          </text>
          <text
            x={x(index)}
            y={height - 8}
            textAnchor="middle"
            fill="#617084"
            fontSize={compact ? 10 : 12}
          >
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
