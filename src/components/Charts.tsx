import { useId, useState } from 'react';
import type { MetricPoint } from '../lib/types';
import { formatDate, formatNumber } from '../lib/utils';

export function Sparkline({
  values,
  color = '#9279e7',
  filled = false,
}: {
  values: number[];
  color?: string;
  filled?: boolean;
}) {
  const id = useId().replaceAll(':', '');
  const min = Math.min(...values, 0),
    max = Math.max(...values, 1);
  const coords = values.map(
    (n, i) =>
      `${6 + i * (190 / Math.max(values.length - 1, 1))},${65 - ((n - min) / (max - min || 1)) * 51}`,
  );
  const points = coords.join(' ');
  return (
    <svg viewBox="0 0 204 74" preserveAspectRatio="none" className="sparkline" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".19" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {filled && <polygon points={`6,74 ${points} 196,74`} fill={`url(#${id})`} />}
      <polyline
        points={points}
        stroke={color}
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.length > 0 && (
        <circle
          cx={coords.at(-1)?.split(',')[0]}
          cy={coords.at(-1)?.split(',')[1]}
          r="3"
          fill={color}
          stroke="white"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}
export function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mini-bars" aria-hidden="true">
      {values.slice(-9).map((n, index) => (
        <span
          key={index}
          style={{ height: `${Math.max((n / max) * 100, 9)}%`, opacity: 0.3 + index * 0.08 }}
        />
      ))}
    </div>
  );
}
export function TrendChart({
  points,
  metric = 'reach',
}: {
  points: MetricPoint[];
  metric?: 'reach' | 'engagement' | 'enquiries';
}) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId().replaceAll(':', '');
  if (!points.length)
    return (
      <div className="chart-placeholder">Connect an analytics source to see your first trend.</div>
    );
  const width = 680,
    left = 60,
    right = 18,
    top = 20,
    bottom = 177;
  const max = Math.max(...points.map((p) => p[metric]), 1) * 1.15;
  const position = (point: MetricPoint, index: number) => ({
    x: left + index * ((width - left - right) / Math.max(points.length - 1, 1)),
    y: bottom - (point[metric] / max) * (bottom - top),
  });
  const coordinates = points.map(position);
  const line = coordinates.map((p) => `${p.x},${p.y}`).join(' ');
  const picked = active === null ? null : points[active];
  const point = active === null ? null : coordinates[active];
  const dateIndices = [
    ...new Set([
      0,
      Math.floor((points.length - 1) / 4),
      Math.floor((points.length - 1) / 2),
      Math.floor(((points.length - 1) * 3) / 4),
      points.length - 1,
    ]),
  ];
  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${width} 215`}
        role="img"
        aria-label={`${metric} over ${points.length} days. ${points[0][metric]} at the start and ${points.at(-1)?.[metric]} at the end.`}
      >
        <defs>
          <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b09aef" stopOpacity=".23" />
            <stop offset="100%" stopColor="#b09aef" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => {
          const y = top + i * ((bottom - top) / 3);
          return (
            <g key={i}>
              <line
                x1={left}
                x2={width - right}
                y1={y}
                y2={y}
                stroke="#edeaf4"
                strokeDasharray="3 5"
              />
              <text x="1" y={y + 3} fill="#6a6479" fontSize="14">
                {formatNumber(Math.round(max * (1 - i / 3)))}
              </text>
            </g>
          );
        })}
        <polygon
          points={`${left},${bottom} ${line} ${width - right},${bottom}`}
          fill={`url(#area-${id})`}
        />
        <polyline
          points={line}
          fill="none"
          stroke="#8c71dc"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {dateIndices.map((i) => (
          <text
            key={i}
            x={coordinates[i].x}
            y="205"
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            fill="#6a6479"
            fontSize="14"
          >
            {formatDate(points[i].date)}
          </text>
        ))}
        {point && picked && (
          <g>
            <line
              x1={point.x}
              x2={point.x}
              y1={top}
              y2={bottom}
              stroke="#c8b9eb"
              strokeDasharray="3 3"
            />
            <circle cx={point.x} cy={point.y} r="4" fill="#8c71dc" stroke="white" strokeWidth="2" />
            <g
              transform={`translate(${Math.min(Math.max(point.x - 65, 60), 532)},${Math.max(point.y - 60, 0)})`}
            >
              <rect width="130" height="48" rx="8" fill="#242238" />
              <text x="65" y="18" textAnchor="middle" fill="#c2b8d8" fontSize="14">
                {formatDate(picked.date)}
              </text>
              <text x="65" y="37" textAnchor="middle" fill="white" fontSize="14">
                {formatNumber(picked[metric])} {metric}
              </text>
            </g>
          </g>
        )}
        {coordinates.map((p, i) => (
          <rect
            key={i}
            x={p.x - 13}
            y={top}
            width="26"
            height={bottom - top}
            fill="transparent"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          />
        ))}
      </svg>
    </div>
  );
}
