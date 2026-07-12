import { useState } from "react";

type PricePoint = {
  date: string;
  close: number;
};

type PriceChartProps = {
  data: PricePoint[];
};

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 200;

export default function PriceChart({ data }: PriceChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length < 2) {
    return <p className="empty-text">Not enough price history to chart yet.</p>;
  }

  const closes = data.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  function xForIndex(index: number) {
    return (index / (data.length - 1)) * VIEW_WIDTH;
  }

  function yForClose(close: number) {
    return VIEW_HEIGHT - ((close - min) / range) * VIEW_HEIGHT;
  }

  const linePoints = data
    .map((point, index) => `${xForIndex(index)},${yForClose(point.close)}`)
    .join(" ");
  const areaPoints = `0,${VIEW_HEIGHT} ${linePoints} ${VIEW_WIDTH},${VIEW_HEIGHT}`;

  const first = data[0];
  const last = data[data.length - 1];
  const isUp = last.close >= first.close;
  const lineColor = isUp ? "#7ef0a0" : "#ff8c98";
  const periodChangePercent = ((last.close - first.close) / first.close) * 100;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;
    const index = Math.round(relativeX * (data.length - 1));
    setHoverIndex(Math.min(Math.max(index, 0), data.length - 1));
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const hoverXPercent = hoverIndex !== null ? (hoverIndex / (data.length - 1)) * 100 : null;
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
        <defs>
          <linearGradient id="priceChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        <polygon points={areaPoints} fill="url(#priceChartFill)" stroke="none" />
        <polyline
          points={linePoints}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />

        {hoverIndex !== null && (
          <>
            <line
              x1={xForIndex(hoverIndex)}
              x2={xForIndex(hoverIndex)}
              y1={0}
              y2={VIEW_HEIGHT}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={xForIndex(hoverIndex)}
              cy={yForClose(data[hoverIndex].close)}
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
          <strong>{hovered.close.toFixed(2)}</strong>
          <span>{hovered.date}</span>
        </div>
      )}

      <div className="price-chart-labels">
        <span>{first.date}</span>
        <span className={isUp ? "gauge-good" : "gauge-critical"}>
          {isUp ? "▲" : "▼"} {Math.abs(periodChangePercent).toFixed(2)}%
        </span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}
