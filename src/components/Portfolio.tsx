import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";
import InfoTip from "./InfoTip";
import { formatDollars } from "../lib/finance";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type PortfolioSummary = {
  id: number;
  name: string;
  transactionCount: number;
};

type Holding = {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number | null;
  marketValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
};

type PortfolioDetail = {
  id: number;
  name: string;
  holdings: Holding[];
  totals: {
    marketValue: number;
    costBasis: number;
    gainLoss: number;
    gainLossPercent: number | null;
    realizedGainLoss: number;
  };
  allocation: { symbol: string; percent: number }[];
};

type LedgerTransaction = {
  id: number;
  symbol: string;
  type: "buy" | "sell";
  shares: number;
  price: number;
  date: string;
};

export default function Portfolio() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!getToken());
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PortfolioDetail | null>(null);
  const [ledger, setLedger] = useState<LedgerTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false);

  const [txSymbol, setTxSymbol] = useState<string>("");
  const [txType, setTxType] = useState<"buy" | "sell">("buy");
  const [txShares, setTxShares] = useState<string>("");
  const [txPrice, setTxPrice] = useState<string>("");
  const [txDate, setTxDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [isAddingTx, setIsAddingTx] = useState<boolean>(false);

  async function loadPortfolios(selectId?: number) {
    if (!getToken()) {
      setIsLoggedIn(false);
      setPortfolios([]);
      setDetail(null);
      setLedger([]);
      setSelectedId(null);
      return;
    }

    setIsLoggedIn(true);

    try {
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/portfolios`);

      if (!response.ok) {
        throw new Error("Failed to load portfolios.");
      }

      const data = await response.json();
      setPortfolios(data.portfolios);
      setLimit(data.limit);

      const nextId =
        selectId ??
        (data.portfolios.some((p: PortfolioSummary) => p.id === selectedId)
          ? selectedId
          : data.portfolios[0]?.id ?? null);

      setSelectedId(nextId);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    }
  }

  async function loadDetail(portfolioId: number) {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const [detailResponse, ledgerResponse] = await Promise.all([
        authFetch(`${API_BASE_URL}/portfolios/${portfolioId}`),
        authFetch(`${API_BASE_URL}/portfolios/${portfolioId}/transactions`),
      ]);

      if (!detailResponse.ok || !ledgerResponse.ok) {
        throw new Error("Failed to load portfolio.");
      }

      setDetail(await detailResponse.json());
      const ledgerData = await ledgerResponse.json();
      setLedger(ledgerData.transactions);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPortfolios();
    const unsubscribe = onAuthChange(() => loadPortfolios());
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadDetail(selectedId);
    } else {
      setDetail(null);
      setLedger([]);
    }
  }, [selectedId]);

  const atFreeLimit = limit !== null && portfolios.length >= limit;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    if (newName.trim() === "") {
      return;
    }

    try {
      setIsCreating(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/portfolios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not create portfolio.");
      }

      setNewName("");
      await loadPortfolios(result.id);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not create portfolio."
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeletePortfolio() {
    if (selectedId === null) {
      return;
    }

    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    try {
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/portfolios/${selectedId}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error("Could not delete portfolio.");
      }

      setSelectedId(null);
      await loadPortfolios();
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not delete portfolio.");
    } finally {
      setIsConfirmingDelete(false);
    }
  }

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();

    if (selectedId === null) {
      return;
    }

    const shares = Number(txShares);
    const price = Number(txPrice);

    if (txSymbol.trim() === "" || !shares || shares <= 0 || !(price >= 0)) {
      setErrorMessage("Please fill in symbol, shares, and price.");
      return;
    }

    try {
      setIsAddingTx(true);
      setErrorMessage("");

      const response = await authFetch(
        `${API_BASE_URL}/portfolios/${selectedId}/transactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: txSymbol.trim().toUpperCase(),
            type: txType,
            shares,
            price,
            date: txDate,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not add that transaction.");
      }

      setTxSymbol("");
      setTxShares("");
      setTxPrice("");
      await Promise.all([loadDetail(selectedId), loadPortfolios(selectedId)]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not add that transaction."
      );
    } finally {
      setIsAddingTx(false);
    }
  }

  async function handleDeleteTransaction(txId: number) {
    if (selectedId === null) {
      return;
    }

    try {
      setErrorMessage("");

      const response = await authFetch(
        `${API_BASE_URL}/portfolios/${selectedId}/transactions/${txId}`,
        { method: "DELETE" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not delete that transaction.");
      }

      await Promise.all([loadDetail(selectedId), loadPortfolios(selectedId)]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not delete that transaction."
      );
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Portfolio</h2>
          <p className="result-subtitle">
            Record what you own and track how it performs.
          </p>
        </div>
        <p className="empty-text">Sign in from the menu to start tracking a portfolio.</p>
      </div>
    );
  }

  return (
    <div className="money-module">
      <div className="result-card">
        <div className="result-header">
          <div>
            <h2>Portfolio</h2>
            <p className="result-subtitle">
              {limit
                ? `Free plan: ${limit} portfolio. Upgrade to Plus for unlimited.`
                : "Record buys and sells; holdings and performance update automatically."}
            </p>
          </div>
        </div>

        {errorMessage && <p className="error-text">{errorMessage}</p>}

        <div className="tools-subnav">
          {portfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`tools-subnav-option ${selectedId === p.id ? "active" : ""}`}
              onClick={() => {
                setSelectedId(p.id);
                setIsConfirmingDelete(false);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {atFreeLimit && portfolios.length > 0 ? null : (
          <form className="portfolio-create-row" onSubmit={handleCreate}>
            <input
              type="text"
              placeholder="New portfolio name, e.g. Retirement"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" disabled={isCreating}>
              {isCreating ? "Creating..." : "Create"}
            </button>
          </form>
        )}

        {atFreeLimit && portfolios.length > 0 && (
          <div className="locked-feature">
            <p>You're using your free portfolio. Upgrade to Plus for unlimited portfolios.</p>
            <span className="tier-badge tier-badge-plus">Plus</span>
          </div>
        )}

        {portfolios.length === 0 && (
          <p className="empty-text">
            No portfolios yet. Create one above, then record your first buy.
          </p>
        )}

        {detail && (
          <>
            <div className="summary-grid">
              <div className="summary-tile">
                <span className="summary-label">Market Value</span>
                <strong>{formatDollars(detail.totals.marketValue)}</strong>
              </div>

              <div className="summary-tile">
                <span className="summary-label">
                  Cost Basis
                  <InfoTip text="What you paid in total for the shares you still hold, using average cost per share." />
                </span>
                <strong>{formatDollars(detail.totals.costBasis)}</strong>
              </div>

              <div className="summary-tile">
                <span className="summary-label">
                  Unrealized Gain/Loss
                  <InfoTip text="Profit or loss on paper for shares you still hold. It becomes 'realized' only when you sell." />
                </span>
                <strong
                  className={detail.totals.gainLoss >= 0 ? "gauge-good" : "gauge-critical"}
                >
                  {formatDollars(detail.totals.gainLoss)}
                  {detail.totals.gainLossPercent !== null
                    ? ` (${detail.totals.gainLossPercent}%)`
                    : ""}
                </strong>
              </div>

              <div className="summary-tile">
                <span className="summary-label">
                  Realized Gain/Loss
                  <InfoTip text="Profit or loss locked in from shares you already sold." />
                </span>
                <strong
                  className={
                    detail.totals.realizedGainLoss >= 0 ? "gauge-good" : "gauge-critical"
                  }
                >
                  {formatDollars(detail.totals.realizedGainLoss)}
                </strong>
              </div>
            </div>

            {isLoading && <p className="helper-text">Refreshing prices...</p>}

            {detail.holdings.length > 0 ? (
              <>
                <h3 className="money-section-title">Holdings</h3>
                <div className="backtest-table-container">
                  <table className="backtest-table">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Shares</th>
                        <th>Avg Cost</th>
                        <th>Price</th>
                        <th>Value</th>
                        <th>Gain/Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.holdings.map((h) => (
                        <tr key={h.symbol}>
                          <td>
                            <strong>{h.symbol}</strong>
                          </td>
                          <td>{h.shares}</td>
                          <td>{formatDollars(h.avgCost)}</td>
                          <td>{h.currentPrice !== null ? formatDollars(h.currentPrice) : "N/A"}</td>
                          <td>{h.marketValue !== null ? formatDollars(h.marketValue) : "N/A"}</td>
                          <td>
                            {h.gainLoss !== null ? (
                              <span className={h.gainLoss >= 0 ? "gauge-good" : "gauge-critical"}>
                                {formatDollars(h.gainLoss)}
                                {h.gainLossPercent !== null ? ` (${h.gainLossPercent}%)` : ""}
                              </span>
                            ) : (
                              "N/A"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {detail.allocation.length > 0 && (
                  <>
                    <h3 className="money-section-title">
                      Allocation
                      <InfoTip text="How your money is split across holdings. Heavy concentration in one stock means one company's bad day is your portfolio's bad day." />
                    </h3>
                    <div className="money-budget-bars">
                      {detail.allocation.map((a) => (
                        <div key={a.symbol} className="money-budget-row">
                          <div className="money-budget-row-label">
                            <span>{a.symbol}</span>
                            <span className="helper-text">{a.percent}%</span>
                          </div>
                          <div className="money-budget-track">
                            <div
                              className="money-budget-fill"
                              style={{ width: `${a.percent}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="empty-text">No holdings yet. Record your first buy below.</p>
            )}

            <h3 className="money-section-title">Record a Transaction</h3>

            <form className="money-add-form" onSubmit={handleAddTransaction}>
              <div className="input-row">
                <div className="field-group">
                  <label className="field-label">Symbol</label>
                  <input
                    type="text"
                    placeholder="e.g. AAPL"
                    value={txSymbol}
                    onChange={(e) => setTxSymbol(e.target.value)}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">Type</label>
                  <select
                    value={txType}
                    onChange={(e) => setTxType(e.target.value as "buy" | "sell")}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
              </div>

              <div className="input-row">
                <div className="field-group">
                  <label className="field-label">Shares</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={txShares}
                    onChange={(e) => setTxShares(e.target.value)}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">
                    Price per Share
                    <InfoTip text="What you paid (or received) per share, not the total order amount." />
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={txPrice}
                    onChange={(e) => setTxPrice(e.target.value)}
                  />
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">Date</label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                />
              </div>

              <button type="submit" disabled={isAddingTx}>
                {isAddingTx ? "Saving..." : "Record Transaction"}
              </button>
            </form>

            {ledger.length > 0 && (
              <>
                <h3 className="money-section-title">Transaction History</h3>
                <div className="money-transaction-list">
                  {ledger.map((t) => (
                    <div key={t.id} className="money-transaction-row">
                      <div>
                        <strong>
                          {t.type === "buy" ? "Bought" : "Sold"} {t.shares} {t.symbol}
                        </strong>
                        <p className="helper-text">
                          {t.date} • {formatDollars(t.price)} per share
                        </p>
                      </div>

                      <div className="money-transaction-amount">
                        <span className={t.type === "buy" ? "" : "gauge-good"}>
                          {t.type === "buy" ? "-" : "+"}
                          {formatDollars(t.shares * t.price)}
                        </span>

                        <button
                          type="button"
                          className="watchlist-remove-button"
                          onClick={() => handleDeleteTransaction(t.id)}
                          aria-label="Delete transaction"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              className="auth-link-button auth-link-button-danger"
              onClick={handleDeletePortfolio}
            >
              {isConfirmingDelete
                ? `Confirm delete "${detail.name}" and its history`
                : "Delete this portfolio"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
