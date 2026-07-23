import { useState } from "react";

type ProjectionPoint = {
  day: number;
  extremeLow: number;
  low: number;
  median: number;
  high: number;
  extremeHigh: number;
};

type PriceProjectionChartProps = {
  series: ProjectionPoint[];
  horizonLabel: string;
};

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 220;

function formatDollars(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PriceProjectionChart({ series, horizonLabel }: PriceProjectionChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!series || series.length < 2) {
    return <p className="empty-text">Not enough data to chart a projection yet.</p>;
  }

  const horizonDays = series[series.length - 1].day;
  const min = Math.min(...series.map((p) => p.extremeLow));
  const max = Math.max(...series.map((p) => p.extremeHigh));
  const range = max - min || 1;

  function xForDay(day: number) {
    return (day / horizonDays) * VIEW_WIDTH;
  }

  function yForPrice(price: number) {
    return VIEW_HEIGHT - ((price - min) / range) * VIEW_HEIGHT;
  }

  const outerTop = series.map((p) => `${xForDay(p.day)},${yForPrice(p.extremeHigh)}`);
  const outerBottom = [...series].reverse().map((p) => `${xForDay(p.day)},${yForPrice(p.extremeLow)}`);
  const outerBand = [...outerTop, ...outerBottom].join(" ");

  const innerTop = series.map((p) => `${xForDay(p.day)},${yForPrice(p.high)}`);
  const innerBottom = [...series].reverse().map((p) => `${xForDay(p.day)},${yForPrice(p.low)}`);
  const innerBand = [...innerTop, ...innerBottom].join(" ");

  const medianLine = series.map((p) => `${xForDay(p.day)},${yForPrice(p.median)}`).join(" ");

  const first = series[0];
  const last = series[series.length - 1];
  const isUp = last.median >= first.median;
  const lineColor = isUp ? "#7ef0a0" : "#ff8c98";

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;
    const targetDay = relativeX * horizonDays;

    let closestIndex = 0;
    let closestDistance = Infinity;
    series.forEach((point, index) => {
      const distance = Math.abs(point.day - targetDay);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setHoverIndex(closestIndex);
  }

  const hovered = hoverIndex !== null ? series[hoverIndex] : null;
  const hoverXPercent = hovered !== null ? (hovered.day / horizonDays) * 100 : null;
  const tooltipLeftPercent =
    hoverXPercent !== null ? Math.min(95, Math.max(5, hoverXPercent)) : null;

  return (
    <div className="price-chart">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="price-chart-svg"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Wider band: ~90% of simulated outcomes -- the lighter wash */}
        <polygon points={outerBand} fill={lineColor} fillOpacity={0.1} stroke="none" />
        {/* Core band: ~68% of simulated outcomes */}
        <polygon points={innerBand} fill={lineColor} fillOpacity={0.22} stroke="none" />

        <polyline
          points={medianLine}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* "Today" starting point */}
        <circle
          cx={xForDay(first.day)}
          cy={yForPrice(first.median)}
          r={4}
          fill={lineColor}
          stroke="#0d0f1a"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />

        {hovered && (
          <>
            <line
              x1={xForDay(hovered.day)}
              x2={xForDay(hovered.day)}
              y1={0}
              y2={VIEW_HEIGHT}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={xForDay(hovered.day)}
              cy={yForPrice(hovered.median)}
              r={4}
              fill={lineColor}
              stroke="#0d0f1a"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      {hovered && tooltipLeftPercent !== null && (
        <div className="price-chart-tooltip" style={{ left: `${tooltipLeftPercent}%` }}>
          <strong>{formatDollars(hovered.median)}</strong>
          <span>
            Day {hovered.day} • {formatDollars(hovered.low)} – {formatDollars(hovered.high)}
          </span>
        </div>
      )}

      <div className="price-chart-labels">
        <span>Today</span>
        <span className={isUp ? "gauge-good" : "gauge-critical"}>
          {isUp ? "▲" : "▼"} median at {horizonLabel}
        </span>
        <span>{horizonLabel}</span>
      </div>
    </div>
  );
}
