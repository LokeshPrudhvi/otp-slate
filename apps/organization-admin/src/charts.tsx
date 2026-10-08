import { useId, useState } from "react";
import "./charts.css";

type TrendPoint = { label: string; value: number };
type Segment = { label: string; value: number; color: string };
type BarItem = { label: string; value: number; color?: string };

const PRIMARY = "#318477";
const cleanValue = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;
const formatValue = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="org-chart-empty" role="status">
      <span className="org-chart-empty-mark" aria-hidden="true">
        ▥
      </span>
      <strong>No data yet</strong>
      <span>{label} will appear as students participate.</span>
    </div>
  );
}

/** Values are plotted from zero; the supplied maximum expands if data exceeds it. */
export function TrendChart({
  points,
  label,
  color = PRIMARY,
  suffix = "%",
  max = 100,
}: {
  points: TrendPoint[];
  label: string;
  color?: string;
  suffix?: string;
  max?: number;
}) {
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  if (!points.length) return <EmptyChart label={label} />;
  const top = 20;
  const bottom = 184;
  const left = 12;
  const right = 628;
  const ceiling = Math.max(
    1,
    cleanValue(max),
    ...points.map((p) => cleanValue(p.value)),
  );
  const coordinates = points.map((point, index) => ({
    ...point,
    value: cleanValue(point.value),
    x:
      points.length === 1
        ? (left + right) / 2
        : left + (index / (points.length - 1)) * (right - left),
    y: bottom - (cleanValue(point.value) / ceiling) * (bottom - top),
  }));
  const path = coordinates
    .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
    .join(" ");
  const area =
    points.length > 1 ? `${path} L${right},${bottom} L${left},${bottom} Z` : "";
  const selected = active === null ? undefined : coordinates[active];
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const labelEvery = Math.max(1, Math.ceil((points.length - 1) / 5));

  return (
    <figure className="org-chart org-chart-trend" aria-label={label}>
      <figcaption className="org-chart-sr-only">{label}</figcaption>
      <div className="org-chart-trend-body">
        <div className="org-chart-y-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>
              {formatValue(ceiling * tick)}
              {suffix}
            </span>
          ))}
        </div>
        <div className="org-chart-trend-plot">
          <svg
            viewBox="0 0 640 204"
            preserveAspectRatio="none"
            role="group"
            aria-label={`${label}. Focus a point to see its value.`}
          >
            <defs>
              <linearGradient
                id={`org-trend-${id}`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={color} stopOpacity="0.015" />
              </linearGradient>
            </defs>
            {ticks.map((tick) => {
              const y = bottom - tick * (bottom - top);
              return (
                <line
                  key={tick}
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                  className="org-chart-grid-line"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {area && <path d={area} fill={`url(#org-trend-${id})`} />}
            {points.length > 1 && (
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {selected && (
              <line
                x1={selected.x}
                x2={selected.x}
                y1={top}
                y2={bottom}
                stroke={color}
                strokeOpacity="0.25"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {coordinates.map((point, index) => (
              <circle
                key={`${point.label}-${index}`}
                cx={point.x}
                cy={point.y}
                r={active === index ? 6 : 4}
                fill="white"
                stroke={color}
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                tabIndex={0}
                role="img"
                aria-label={`${point.label}: ${formatValue(point.value)}${suffix}`}
                className="org-chart-point"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <title>
                  {point.label}: {formatValue(point.value)}
                  {suffix}
                </title>
              </circle>
            ))}
          </svg>
          {selected && (
            <div
              className="org-chart-trend-tooltip"
              style={{
                left: `${Math.min(82, Math.max(18, (selected.x / 640) * 100))}%`,
              }}
              role="status"
            >
              <span>{selected.label}</span>
              <strong>
                {formatValue(selected.value)}
                {suffix}
              </strong>
            </div>
          )}
          <div className="org-chart-x-axis" aria-hidden="true">
            {points.length === 1 ? (
              <span className="org-chart-single-label">{points[0].label}</span>
            ) : (
              coordinates.map(
                (point, index) =>
                  (index % labelEvery === 0 || index === points.length - 1) && (
                    <span
                      key={`${point.label}-${index}`}
                      style={{ left: `${(point.x / 640) * 100}%` }}
                      className={
                        index === 0
                          ? "org-chart-label-first"
                          : index === points.length - 1
                            ? "org-chart-label-last"
                            : undefined
                      }
                    >
                      {point.label}
                    </span>
                  ),
              )
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

export function DonutChart({
  segments,
  label,
  centerValue,
  centerLabel,
}: {
  segments: Segment[];
  label: string;
  centerValue: string;
  centerLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (!segments.length) return <EmptyChart label={label} />;
  const total = segments.reduce(
    (sum, segment) => sum + cleanValue(segment.value),
    0,
  );
  const selected = active === null ? undefined : segments[active];
  const radius = 71;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <figure className="org-chart org-chart-donut" aria-label={label}>
      <div className="org-chart-donut-visual">
        <svg
          viewBox="0 0 180 180"
          role="img"
          aria-label={`${label}: ${segments.map((segment) => `${segment.label} ${formatValue(cleanValue(segment.value))}`).join(", ")}`}
        >
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="#edf0f2"
            strokeWidth="19"
          />
          {segments.map((segment, index) => {
            const value = cleanValue(segment.value);
            const length = total ? (value / total) * circumference : 0;
            const startingOffset = offset;
            offset += length;
            if (!value) return null;
            const gap = value === total ? 0 : Math.min(3, length / 3);
            return (
              <circle
                key={`${segment.label}-${index}`}
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={active === index ? 23 : 19}
                strokeDasharray={`${Math.max(0, length - gap)} ${circumference - Math.max(0, length - gap)}`}
                strokeDashoffset={-startingOffset}
                transform="rotate(-90 90 90)"
                className="org-chart-donut-segment"
                opacity={active !== null && active !== index ? 0.4 : 1}
              />
            );
          })}
        </svg>
        <div className="org-chart-donut-center" aria-hidden="true">
          <strong>
            {selected ? formatValue(cleanValue(selected.value)) : centerValue}
          </strong>
          <span>{selected ? selected.label : centerLabel}</span>
        </div>
      </div>
      <figcaption className="org-chart-legend" aria-label={label}>
        {segments.map((segment, index) => (
          <div
            key={`${segment.label}-${index}`}
            className={`org-chart-legend-item${active === index ? " is-active" : ""}`}
            tabIndex={0}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            aria-label={`${segment.label}: ${formatValue(cleanValue(segment.value))}, ${total ? Math.round((cleanValue(segment.value) / total) * 100) : 0} percent`}
          >
            <span
              className="org-chart-legend-dot"
              style={{ background: segment.color }}
              aria-hidden="true"
            />
            <span>{segment.label}</span>
            <strong>{formatValue(cleanValue(segment.value))}</strong>
            <small>
              {total
                ? Math.round((cleanValue(segment.value) / total) * 100)
                : 0}
              %
            </small>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

export function BarChart({
  items,
  label,
  max,
  suffix = "",
}: {
  items: BarItem[];
  label: string;
  max?: number;
  suffix?: string;
}) {
  if (!items.length) return <EmptyChart label={label} />;
  const maximum = Math.max(
    1,
    cleanValue(max ?? 0),
    ...items.map((item) => cleanValue(item.value)),
  );
  const ceiling = items.every((item) => Number.isInteger(item.value))
    ? Math.ceil(maximum / 2) * 2
    : maximum;
  return (
    <figure className="org-chart org-chart-bars" aria-label={label}>
      <figcaption className="org-chart-sr-only">{label}</figcaption>
      <div className="org-chart-bars-main">
        <div className="org-chart-bar-axis" aria-hidden="true">
          {[1, 0.5, 0].map((tick) => (
            <span key={tick}>
              {formatValue(ceiling * tick)}
              {suffix}
            </span>
          ))}
        </div>
        <div className="org-chart-bar-columns">
          <div className="org-chart-bar-grid" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          {items.map((item, index) => (
            <div
              key={`${item.label}-${index}`}
              className="org-chart-bar-column"
              tabIndex={0}
              aria-label={`${item.label}: ${formatValue(cleanValue(item.value))}${suffix}`}
            >
              <div className="org-chart-bar-well">
                <div
                  className="org-chart-bar-fill"
                  style={{
                    height: `${(cleanValue(item.value) / ceiling) * 100}%`,
                    background: item.color ?? PRIMARY,
                  }}
                >
                  <span className="org-chart-bar-value">
                    {formatValue(cleanValue(item.value))}
                    {suffix}
                  </span>
                </div>
              </div>
              <span className="org-chart-bar-label">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

export function SkillChart({
  items,
  label = "Skill performance",
}: {
  items: Array<{ name: string; average: number }>;
  label?: string;
}) {
  if (!items.length) return <EmptyChart label={label} />;
  return (
    <figure className="org-chart org-chart-skills" aria-label={label}>
      <figcaption className="org-chart-sr-only">{label}</figcaption>
      {items.map((item, index) => {
        const value = cleanValue(item.average);
        return (
          <div
            key={`${item.name}-${index}`}
            className="org-chart-skill-row"
            tabIndex={0}
            aria-label={`${item.name}: ${formatValue(value)} percent`}
          >
            <div className="org-chart-skill-label">
              <span>{item.name}</span>
              <strong>
                {formatValue(value)}
                <small>%</small>
              </strong>
            </div>
            <div className="org-chart-skill-track" aria-hidden="true">
              <span
                style={{
                  width: `${Math.min(100, value)}%`,
                  background:
                    value >= 70 ? PRIMARY : value >= 45 ? "#79aaa0" : "#e8b84e",
                }}
              />
            </div>
          </div>
        );
      })}
    </figure>
  );
}
