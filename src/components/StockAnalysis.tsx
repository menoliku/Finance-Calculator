import { useEffect, useState } from "react";
import AnalystGauge from "./AnalystGauge";
import PriceChart from "./PriceChart";
import PriceProjectionCard from "./PriceProjectionCard";
import { authHeaders, getToken, onAuthChange } from "../auth";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type Fundamentals = {
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  beta: number | null;
  profitMargins: number | null;
  revenueGrowth: number | null;
  debtToEquity: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyDayAverage: number | null;
};

type AnalystInfo = {
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
};

type NewsSentiment = "positive" | "negative" | "neutral";

type NewsItem = {
  title: string;
  publisher: string | null;
  link: string | null;
  publishedAt: string | null;
  sentiment: NewsSentiment | null;
  sentimentScore: number | null;
};

type PricePoint = {
  date: string;
  close: number;
};

type AnalysisUnlocks = {
  priceHistory: boolean;
  analystConsensus: boolean;
  newsSentiment: boolean;
  priceProjection: boolean;
};

type StockAnalysisData = {
  symbol: string;
  name: string;
  fundamentals: Fundamentals;
  analyst: AnalystInfo;
  news: NewsItem[];
  summary: string[];
  priceHistory: PricePoint[];
  unlocks: AnalysisUnlocks;
  disclaimer: string;
};

type StockAnalysisProps = {
  symbol: string;
};

function formatRatio(value: number | null) {
  return value === null || value === undefined ? "N/A" : value.toFixed(2);
}

function formatPercent(value: number | null) {
  return value === null || value === undefined
    ? "N/A"
    : `${(value * 100).toFixed(2)}%`;
}

// yfinance reports dividendYield already as a percentage (e.g. 2.52 for 2.52%),
// unlike profitMargins/revenueGrowth which are fractions (e.g. 0.27 for 27%).
function formatDividendYield(value: number | null) {
  return value === null || value === undefined ? "N/A" : `${value.toFixed(2)}%`;
}

const SENTIMENT_DISPLAY: Record<
  NewsSentiment,
  { label: string; icon: string; className: string }
> = {
  positive: { label: "Positive", icon: "▲", className: "sentiment-positive" },
  negative: { label: "Negative", icon: "▼", className: "sentiment-negative" },
  neutral: { label: "Neutral", icon: "–", className: "sentiment-neutral" },
};

export default function StockAnalysis({ symbol }: StockAnalysisProps) {
  const [data, setData] = useState<StockAnalysisData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [watchlistMessage, setWatchlistMessage] = useState<string>("");
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    setWatchlistMessage("");

    if (symbol.trim() === "") {
      setData(null);
      setErrorMessage("");
      return;
    }

    async function loadAnalysis() {
      try {
        setIsLoading(true);
        setErrorMessage("");

        const response = await fetch(
          `${API_BASE_URL}/stocks/analysis?symbol=${encodeURIComponent(symbol)}`,
          { headers: authHeaders() }
        );

        const result = await response.json();

        if (isCancelled) {
          return;
        }

        // Guard the shape, not just the error flag -- rate-limit and validation
        // responses come back as {detail: ...} with no error key, and rendering
        // them as analysis data crashes on fundamentals.trailingPE.
        if (!response.ok || result.error || !result.fundamentals || !result.analyst) {
          setData(null);
          setErrorMessage("Failed to load stock analysis.");
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

    loadAnalysis();

    // Refetch when login/logout/upgrade changes -- premium fields depend on it.
    const unsubscribe = onAuthChange(loadAnalysis);

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [symbol]);

  async function handleAddToWatchlist() {
    if (!getToken() || !data) {
      return;
    }

    try {
      setIsAddingToWatchlist(true);
      setWatchlistMessage("");

      const response = await fetch(`${API_BASE_URL}/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ symbol: data.symbol }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not add to watchlist.");
      }

      setWatchlistMessage("Added to your watchlist.");
    } catch (error) {
      setWatchlistMessage(
        error instanceof Error ? error.message : "Could not add to watchlist."
      );
    } finally {
      setIsAddingToWatchlist(false);
    }
  }

  if (isLoading) {
    return <p className="helper-text">Loading analysis...</p>;
  }

  if (errorMessage) {
    return <p className="error-text">{errorMessage}</p>;
  }

  if (!data) {
    return null;
  }

  const { fundamentals, analyst, news, summary, disclaimer, unlocks } = data;

  return (
    <div className="result-card analysis-card">
      <div className="result-header">
        <div>
          <h2>Stock Analysis</h2>
          <p className="result-subtitle">
            Fundamentals, analyst opinion, and news for {data.name} ({data.symbol}).
          </p>
        </div>

        {getToken() && (
          <button
            type="button"
            className="watchlist-add-button"
            onClick={handleAddToWatchlist}
            disabled={isAddingToWatchlist}
          >
            {isAddingToWatchlist ? "Adding..." : "+ Watchlist"}
          </button>
        )}
      </div>

      {watchlistMessage && <p className="helper-text">{watchlistMessage}</p>}

      <div>
        <h3>Price History (6 Months)</h3>
        {unlocks.priceHistory ? (
          <PriceChart data={data.priceHistory} />
        ) : (
          <div className="locked-feature">
            <p>A 6-month price trend chart is a Plus feature.</p>
            <span className="tier-badge tier-badge-plus">Plus</span>
          </div>
        )}
      </div>

      <div className="summary-grid">
        <div className="summary-tile">
          <span className="summary-label">Trailing P/E</span>
          <strong>{formatRatio(fundamentals.trailingPE)}</strong>
        </div>

        <div className="summary-tile">
          <span className="summary-label">Forward P/E</span>
          <strong>{formatRatio(fundamentals.forwardPE)}</strong>
        </div>

        <div className="summary-tile">
          <span className="summary-label">Dividend Yield</span>
          <strong>{formatDividendYield(fundamentals.dividendYield)}</strong>
        </div>

        <div className="summary-tile">
          <span className="summary-label">Beta</span>
          <strong>{formatRatio(fundamentals.beta)}</strong>
        </div>

        <div className="summary-tile">
          <span className="summary-label">Profit Margin</span>
          <strong>{formatPercent(fundamentals.profitMargins)}</strong>
        </div>

        <div className="summary-tile">
          <span className="summary-label">Revenue Growth</span>
          <strong>{formatPercent(fundamentals.revenueGrowth)}</strong>
        </div>
      </div>

      <div className="details-grid">
        <div className="detail-box">
          <span className="detail-label">Analyst Target Price</span>
          <p>
            {formatRatio(analyst.targetMeanPrice)}
            {" "}(Low {formatRatio(analyst.targetLowPrice)} / High{" "}
            {formatRatio(analyst.targetHighPrice)})
          </p>
        </div>

        <div className="detail-box">
          <span className="detail-label">52 Week Range</span>
          <p>
            {formatRatio(fundamentals.fiftyTwoWeekLow)} -{" "}
            {formatRatio(fundamentals.fiftyTwoWeekHigh)}
          </p>
        </div>

        <div className="detail-box">
          <span className="detail-label">Debt to Equity</span>
          <p>{formatRatio(fundamentals.debtToEquity)}</p>
        </div>
      </div>

      <div>
        <h3>Analyst Consensus</h3>
        {unlocks.analystConsensus ? (
          <AnalystGauge
            recommendationMean={analyst.recommendationMean}
            recommendationKey={analyst.recommendationKey}
            numberOfAnalystOpinions={analyst.numberOfAnalystOpinions}
          />
        ) : (
          <div className="locked-feature">
            <p>Analyst buy/hold/sell consensus is a Pro feature.</p>
            <span className="tier-badge tier-badge-pro">Pro</span>
          </div>
        )}
      </div>

      <div>
        <h3>Statistical Price Outlook</h3>
        {unlocks.priceProjection ? (
          <PriceProjectionCard symbol={data.symbol} />
        ) : (
          <div className="locked-feature">
            <p>
              A statistical price range based on volatility, trend, and news
              signals is an Ultimate feature.
            </p>
            <span className="tier-badge tier-badge-ultimate">Ultimate</span>
          </div>
        )}
      </div>

      <div className="analysis-summary">
        <h3>Beginner Summary</h3>

        {summary.length > 0 ? (
          <ul className="analysis-summary-list">
            {summary.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-text">No summary available for this stock.</p>
        )}
      </div>

      <div>
        <h3>Recent News</h3>

        {news.length > 0 ? (
          <ul className="analysis-news-list">
            {news.map((item, index) => {
              const sentiment = item.sentiment ? SENTIMENT_DISPLAY[item.sentiment] : null;

              return (
                <li
                  key={index}
                  className={`analysis-news-item ${sentiment?.className ?? ""}`}
                >
                  <div className="analysis-news-item-header">
                    {item.link ? (
                      <a href={item.link} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                    ) : (
                      <span>{item.title}</span>
                    )}

                    {sentiment ? (
                      <span className={`sentiment-badge ${sentiment.className}`}>
                        {sentiment.icon} {sentiment.label}
                      </span>
                    ) : (
                      <span className="sentiment-badge sentiment-locked">
                        🔒 Pro
                      </span>
                    )}
                  </div>

                  {item.publisher && (
                    <p className="helper-text">{item.publisher}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-text">No recent news found for this stock.</p>
        )}
      </div>

      <p className="helper-text">{disclaimer}</p>
    </div>
  );
}
