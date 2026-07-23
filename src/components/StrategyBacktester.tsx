import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";
import { hasTier } from "../lib/tiers";
import InfoTip from "./InfoTip";
import EquityCurveChart from "./EquityCurveChart";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type Trade = {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPercent: number;
  isWin: boolean;
  stillOpen: boolean;
};

type Attempt = {
  name: string;
  description: string;
  totalTrades: number;
  winRate: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  trades: Trade[];
  equityCurve: { date: string; equity: number }[];
};

type BacktestResult = {
  symbol: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  buyAndHoldReturnPercent: number;
  attempts: Attempt[];
  bestAttemptIndex: number;
  reachedPerfectWinRate: boolean;
  lowSampleWarning: boolean;
  difficultyExplanation: string;
  disclaimer: string;
};

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function StrategyBacktester() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!getToken());
  const [isPro, setIsPro] = useState<boolean>(false);
  const [symbol, setSymbol] = useState<string>("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  async function checkTier() {
    const token = getToken();
    setIsLoggedIn(!!token);

    if (!token) {
      setIsPro(false);
      return;
    }

    try {
      const response = await authFetch(`${API_BASE_URL}/auth/me`);
      if (!response.ok) {
        throw new Error("Session expired");
      }
      const data = await response.json();
      setIsPro(hasTier(data.subscriptionTier, "pro"));
    } catch {
      setIsPro(false);
    }
  }

  useEffect(() => {
    checkTier();
    const unsubscribe = onAuthChange(checkTier);
    return unsubscribe;
  }, []);

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();

    const cleanSymbol = symbol.trim().toUpperCase();
    if (cleanSymbol === "") {
      return;
    }

    try {
      setIsRunning(true);
      setErrorMessage("");
      setResult(null);
      setExpandedIndex(null);

      const response = await authFetch(`${API_BASE_URL}/stocks/strategy-backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: cleanSymbol }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not run the backtest.");
      }

      if (data.error) {
        setErrorMessage(data.error);
        return;
      }

      setResult(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not run the backtest.");
    } finally {
      setIsRunning(false);
    }
  }

  if (!isLoggedIn || !isPro) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Strategy Backtester</h2>
          <p className="result-subtitle">
            Test a MACD-based trading rule against years of real price history.
          </p>
        </div>
        <div className="locked-feature">
          <p>
            {isLoggedIn
              ? "The strategy backtester is a Pro feature."
              : "Sign in and upgrade to Pro to use the strategy backtester."}
          </p>
          <span className="tier-badge tier-badge-pro">Pro</span>
        </div>
      </div>
    );
  }

  return (
    <div className="result-card">
      <div className="result-header">
        <div>
          <h2>Strategy Backtester</h2>
          <p className="result-subtitle">
            Tests a MACD-based buy/sell rule -- and two more refined versions of it --
            against 5 years of real price history.
          </p>
        </div>
      </div>

      <form className="watchlist-add-row" onSubmit={handleRun}>
        <input
          type="text"
          placeholder="Enter a symbol, e.g. AAPL"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <button type="submit" disabled={isRunning}>
          {isRunning ? "Running..." : "Run Backtest"}
        </button>
      </form>

      {errorMessage && <p className="error-text">{errorMessage}</p>}
      {isRunning && <p className="helper-text">Simulating 3 strategy attempts over 5 years of data...</p>}

      {result && (
        <>
          <p className="result-subtitle">
            {result.name} ({result.symbol}) · {result.periodStart} to {result.periodEnd} · Buy-and-hold
            over this period: <strong>{formatPercent(result.buyAndHoldReturnPercent)}</strong>
          </p>

          <p className="note-callout">{result.difficultyExplanation}</p>

          {result.attempts.map((attempt, index) => {
            const isBest = index === result.bestAttemptIndex;
            const isExpanded = expandedIndex === index;

            return (
              <div key={attempt.name} className="strategy-attempt-card">
                <div className="strategy-attempt-header">
                  <div>
                    <h3>
                      {attempt.name}
                      {isBest && <span className="tier-badge tier-badge-plus">Best</span>}
                    </h3>
                    <p className="helper-text">{attempt.description}</p>
                  </div>
                </div>

                <div className="summary-grid">
                  <div className="summary-tile">
                    <span className="summary-label">Total Return</span>
                    <strong className={attempt.totalReturnPercent >= 0 ? "gauge-good" : "gauge-critical"}>
                      {formatPercent(attempt.totalReturnPercent)}
                    </strong>
                  </div>

                  <div className="summary-tile">
                    <span className="summary-label">
                      Win Rate
                      <InfoTip text="The share of completed trades that were profitable. A high win rate with a low total return can still be a weak strategy -- always check both." />
                    </span>
                    <strong>
                      {attempt.winRate}% ({attempt.totalTrades} trades)
                    </strong>
                  </div>

                  <div className="summary-tile">
                    <span className="summary-label">
                      Max Drawdown
                      <InfoTip text="The largest peak-to-trough decline this strategy would have experienced. Lower is generally safer." />
                    </span>
                    <strong className="gauge-critical">-{attempt.maxDrawdownPercent}%</strong>
                  </div>
                </div>

                {attempt.equityCurve.length > 1 && <EquityCurveChart data={attempt.equityCurve} />}

                {attempt.trades.length > 0 && (
                  <button
                    type="button"
                    className="strategy-toggle-trades"
                    onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  >
                    {isExpanded ? "Hide trade list" : `Show ${attempt.trades.length} trades`}
                  </button>
                )}

                {isExpanded && (
                  <div className="backtest-table-container">
                    <table className="backtest-table">
                      <thead>
                        <tr>
                          <th>Entry</th>
                          <th>Exit</th>
                          <th>Return</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempt.trades.map((trade, tIndex) => (
                          <tr key={tIndex}>
                            <td>
                              {trade.entryDate}
                              <br />
                              <span className="helper-text">${trade.entryPrice}</span>
                            </td>
                            <td>
                              {trade.exitDate}
                              {trade.stillOpen && (
                                <span className="helper-text"> (still open)</span>
                              )}
                              <br />
                              <span className="helper-text">${trade.exitPrice}</span>
                            </td>
                            <td>
                              <span className={trade.isWin ? "gauge-good" : "gauge-critical"}>
                                {formatPercent(trade.returnPercent)}
                              </span>
                            </td>
                            <td>
                              <span className={trade.isWin ? "gauge-good" : "gauge-critical"}>
                                {trade.isWin ? "Win" : "Loss"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          <p className="helper-text">{result.disclaimer}</p>
        </>
      )}
    </div>
  );
}
