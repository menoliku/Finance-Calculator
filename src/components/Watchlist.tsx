import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type WatchlistItem = {
  symbol: string;
  name: string;
  price: number | null;
  currency: string;
  changePercent: number | null;
  addedAt: string;
};

type WatchlistData = {
  items: WatchlistItem[];
  isPremiumUser: boolean;
  limit: number | null;
};

type WatchlistProps = {
  onSelectSymbol: (symbol: string) => void;
};

function formatMoney(value: number | null, currency: string) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return `${currency ? currency + " " : ""}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function Watchlist({ onSelectSymbol }: WatchlistProps) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!getToken());
  const [data, setData] = useState<WatchlistData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [newSymbol, setNewSymbol] = useState<string>("");
  const [isAdding, setIsAdding] = useState<boolean>(false);

  async function loadWatchlist() {
    if (!getToken()) {
      setIsLoggedIn(false);
      setData(null);
      return;
    }

    setIsLoggedIn(true);

    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/watchlist`);

      if (!response.ok) {
        throw new Error("Failed to load watchlist.");
      }

      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadWatchlist();
    const unsubscribe = onAuthChange(loadWatchlist);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();

    const symbol = newSymbol.trim().toUpperCase();

    if (symbol === "") {
      return;
    }

    try {
      setIsAdding(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not add that stock.");
      }

      setNewSymbol("");
      await loadWatchlist();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not add that stock.");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(symbol: string) {
    try {
      const response = await authFetch(`${API_BASE_URL}/watchlist/${symbol}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error("Could not remove that stock.");
      }

      await loadWatchlist();
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not remove that stock.");
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Watchlist</h2>
          <p className="result-subtitle">
            Save stocks to check on them at a glance.
          </p>
        </div>
        <p className="empty-text">Sign in from the menu to build a watchlist.</p>
      </div>
    );
  }

  return (
    <div className="result-card">
      <div className="result-header">
        <h2>Watchlist</h2>
        <p className="result-subtitle">
          {data?.limit
            ? `Free plan: up to ${data.limit} stocks. Upgrade to Plus for unlimited.`
            : "Track stocks and jump straight to their analysis."}
        </p>
      </div>

      <form className="watchlist-add-row" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Add a symbol, e.g. AAPL"
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.target.value)}
        />
        <button type="submit" disabled={isAdding}>
          {isAdding ? "Adding..." : "Add"}
        </button>
      </form>

      {errorMessage && <p className="error-text">{errorMessage}</p>}

      {isLoading ? (
        <p className="helper-text">Loading watchlist...</p>
      ) : data && data.items.length > 0 ? (
        <div className="watchlist-items">
          {data.items.map((item) => (
            <div key={item.symbol} className="watchlist-item">
              <div className="watchlist-item-main" onClick={() => onSelectSymbol(item.symbol)}>
                <div>
                  <strong>{item.symbol}</strong>
                  <p className="helper-text">{item.name}</p>
                </div>
                <div className="watchlist-item-price">
                  <p className="recommendation-card-price">
                    {formatMoney(item.price, item.currency)}
                  </p>
                  {item.changePercent !== null && (
                    <span
                      className={item.changePercent >= 0 ? "gauge-good" : "gauge-critical"}
                    >
                      {item.changePercent >= 0 ? "▲" : "▼"} {Math.abs(item.changePercent)}%
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="watchlist-remove-button"
                onClick={() => handleRemove(item.symbol)}
                aria-label={`Remove ${item.symbol} from watchlist`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-text">
          No stocks saved yet. Add one above, or search a stock and add it from the Analysis tab.
        </p>
      )}
    </div>
  );
}
