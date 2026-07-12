import { useEffect, useState } from "react";
import { authFetch, authHeaders, getToken, onAuthChange } from "../auth";
import { hasTier } from "../lib/tiers";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type ComparisonResult = {
  symbol: string;
  name: string;
  price: number | null;
  currency: string;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  beta: number | null;
  profitMargins: number | null;
  revenueGrowth: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  recommendationKey: string | null;
};

function formatRatio(value: number | null) {
  return value === null || value === undefined ? "N/A" : value.toFixed(2);
}

function formatPercent(value: number | null) {
  return value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(2)}%`;
}

function formatMoney(value: number | null, currency: string) {
  return value === null || value === undefined ? "N/A" : `${currency} ${value.toFixed(2)}`;
}

function formatRecommendation(key: string | null) {
  if (!key) {
    return "N/A";
  }
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const ROWS: { label: string; render: (r: ComparisonResult) => string }[] = [
  { label: "Price", render: (r) => formatMoney(r.price, r.currency) },
  { label: "Trailing P/E", render: (r) => formatRatio(r.trailingPE) },
  { label: "Forward P/E", render: (r) => formatRatio(r.forwardPE) },
  { label: "Dividend Yield", render: (r) => (r.dividendYield !== null ? `${r.dividendYield.toFixed(2)}%` : "N/A") },
  { label: "Beta", render: (r) => formatRatio(r.beta) },
  { label: "Profit Margin", render: (r) => formatPercent(r.profitMargins) },
  { label: "Revenue Growth", render: (r) => formatPercent(r.revenueGrowth) },
  {
    label: "52 Week Range",
    render: (r) => `${formatRatio(r.fiftyTwoWeekLow)} - ${formatRatio(r.fiftyTwoWeekHigh)}`,
  },
  { label: "Analyst Rating", render: (r) => formatRecommendation(r.recommendationKey) },
];

export default function StockComparison() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!getToken());
  const [isPremium, setIsPremium] = useState<boolean>(false);
  const [symbols, setSymbols] = useState<string[]>(["", "", ""]);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function checkPremiumStatus() {
    const token = getToken();
    setIsLoggedIn(!!token);

    if (!token) {
      setIsPremium(false);
      return;
    }

    try {
      const response = await authFetch(`${API_BASE_URL}/auth/me`);
      if (!response.ok) {
        throw new Error("Session expired");
      }
      const data = await response.json();
      setIsPremium(hasTier(data.subscriptionTier, "pro"));
    } catch {
      setIsPremium(false);
    }
  }

  useEffect(() => {
    checkPremiumStatus();
    const unsubscribe = onAuthChange(checkPremiumStatus);
    return unsubscribe;
  }, []);

  async function handleCompare() {
    const cleanSymbols = symbols
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s !== "");

    if (cleanSymbols.length < 2) {
      setErrorMessage("Enter at least 2 stock symbols to compare.");
      return;
    }

    try {
      setIsComparing(true);
      setErrorMessage("");
      setResults([]);

      const responses = await Promise.all(
        cleanSymbols.map((symbol) =>
          Promise.all([
            fetch(`${API_BASE_URL}/stocks/analysis?symbol=${encodeURIComponent(symbol)}`, {
              headers: authHeaders(),
            }).then((r) => r.json()),
            fetch(`${API_BASE_URL}/stocks/price?symbol=${encodeURIComponent(symbol)}`).then((r) =>
              r.json()
            ),
          ])
        )
      );

      const valid: ComparisonResult[] = [];
      const failed: string[] = [];

      responses.forEach(([data, priceData], index) => {
        if (data.error) {
          failed.push(cleanSymbols[index]);
          return;
        }

        valid.push({
          symbol: data.symbol,
          name: data.name,
          price: priceData.error ? null : priceData.price,
          currency: priceData.error ? "" : priceData.currency,
          trailingPE: data.fundamentals.trailingPE,
          forwardPE: data.fundamentals.forwardPE,
          dividendYield: data.fundamentals.dividendYield,
          beta: data.fundamentals.beta,
          profitMargins: data.fundamentals.profitMargins,
          revenueGrowth: data.fundamentals.revenueGrowth,
          fiftyTwoWeekLow: data.fundamentals.fiftyTwoWeekLow,
          fiftyTwoWeekHigh: data.fundamentals.fiftyTwoWeekHigh,
          recommendationKey: data.analyst?.recommendationKey ?? null,
        });
      });

      if (failed.length > 0) {
        setErrorMessage(`Could not load: ${failed.join(", ")}`);
      }

      setResults(valid);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsComparing(false);
    }
  }

  if (!isLoggedIn || !isPremium) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Compare Stocks</h2>
          <p className="result-subtitle">
            See fundamentals, analyst ratings, and risk side by side for up to 3 stocks.
          </p>
        </div>
        <div className="locked-feature">
          <p>
            {isLoggedIn
              ? "Comparing stocks side by side is a Pro feature."
              : "Sign in and upgrade to Pro to compare stocks side by side."}
          </p>
          <span className="tier-badge tier-badge-pro">Pro</span>
        </div>
      </div>
    );
  }

  return (
    <div className="result-card">
      <div className="result-header">
        <h2>Compare Stocks</h2>
        <p className="result-subtitle">
          Enter 2-3 symbols to see them side by side.
        </p>
      </div>

      <div className="comparison-inputs">
        {symbols.map((value, index) => (
          <input
            key={index}
            type="text"
            placeholder={`Symbol ${index + 1}`}
            value={value}
            onChange={(e) => {
              const next = [...symbols];
              next[index] = e.target.value;
              setSymbols(next);
            }}
          />
        ))}
      </div>

      <button type="button" onClick={handleCompare} disabled={isComparing}>
        {isComparing ? "Comparing..." : "Compare"}
      </button>

      {errorMessage && <p className="error-text">{errorMessage}</p>}

      {results.length > 0 && (
        <>
          <p className="table-scroll-hint">Swipe left/right to see more →</p>
          <div className="comparison-table-container">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Metric</th>
                {results.map((r) => (
                  <th key={r.symbol}>
                    {r.symbol}
                    <span className="helper-text">{r.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {results.map((r) => (
                    <td key={r.symbol}>{row.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
