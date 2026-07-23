import { useEffect, useState } from "react";
import { authFetch } from "../auth";
import InfoTip from "./InfoTip";
import PriceProjectionChart from "./PriceProjectionChart";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type HorizonDays = 30 | 90 | 365;

const HORIZONS: { key: HorizonDays; label: string }[] = [
  { key: 30, label: "30 Days" },
  { key: 90, label: "90 Days" },
  { key: 365, label: "1 Year" },
];

type Factor = {
  name: string;
  reading: string;
  note: string;
};

type ProjectionPoint = {
  day: number;
  extremeLow: number;
  low: number;
  median: number;
  high: number;
  extremeHigh: number;
};

type ProjectionData = {
  symbol: string;
  name: string;
  currentPrice: number;
  horizonDays: number;
  projection: {
    extremeLow: number;
    low: number;
    median: number;
    high: number;
    extremeHigh: number;
  };
  series: ProjectionPoint[];
  methodology: {
    annualVolatility: number;
    baselineDrift: number;
    signalTilt: number;
    compositeScore: number;
    factors: Factor[];
  };
  disclaimer: string;
};

function formatDollars(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type PriceProjectionCardProps = {
  symbol: string;
};

export default function PriceProjectionCard({ symbol }: PriceProjectionCardProps) {
  const [horizon, setHorizon] = useState<HorizonDays>(30);
  const [data, setData] = useState<ProjectionData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;

    async function loadProjection() {
      try {
        setIsLoading(true);
        setErrorMessage("");

        const response = await authFetch(
          `${API_BASE_URL}/stocks/price-projection?symbol=${encodeURIComponent(
            symbol
          )}&horizonDays=${horizon}`
        );

        const result = await response.json();

        if (isCancelled) {
          return;
        }

        if (!response.ok || result.error) {
          setData(null);
          setErrorMessage(result.detail || result.error || "Could not build a projection.");
          return;
        }

        setData(result);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        console.error(error);
        setData(null);
        setErrorMessage("Cannot connect to backend.");
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    if (symbol.trim() !== "") {
      loadProjection();
    }

    return () => {
      isCancelled = true;
    };
  }, [symbol, horizon]);

  return (
    <div>
      <div className="tools-subnav">
        {HORIZONS.map((h) => (
          <button
            key={h.key}
            type="button"
            className={`tools-subnav-option ${horizon === h.key ? "active" : ""}`}
            onClick={() => setHorizon(h.key)}
          >
            {h.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="helper-text">Running simulation...</p>}
      {errorMessage && <p className="error-text">{errorMessage}</p>}

      {data && !isLoading && (
        <>
          <PriceProjectionChart
            series={data.series}
            horizonLabel={HORIZONS.find((h) => h.key === horizon)?.label ?? `${horizon} Days`}
          />

          <div className="summary-grid">
            <div className="summary-tile">
              <span className="summary-label">Low</span>
              <strong>{formatDollars(data.projection.low)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">
                Typical
                <InfoTip text="The median of 2,000 simulated price paths -- the middle outcome, not a prediction of what will actually happen." />
              </span>
              <strong>{formatDollars(data.projection.median)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">High</span>
              <strong>{formatDollars(data.projection.high)}</strong>
            </div>
          </div>

          <p className="helper-text">
            68% range shown above. Wider range (~90% of outcomes):{" "}
            {formatDollars(data.projection.extremeLow)} –{" "}
            {formatDollars(data.projection.extremeHigh)}.
          </p>

          <h4>
            What went into this
            <InfoTip text="Every factor below nudges the projection's center slightly -- none of them override the stock's own historical volatility, which does most of the work in setting the range." />
          </h4>

          <ul className="analysis-summary-list">
            {data.methodology.factors.map((factor) => (
              <li key={factor.name}>
                <strong>{factor.name}:</strong> {factor.reading} — {factor.note}
              </li>
            ))}
          </ul>

          <p className="helper-text">{data.disclaimer}</p>
        </>
      )}
    </div>
  );
}
