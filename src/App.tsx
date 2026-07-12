import { useState } from "react";
import "./App.css";
import StockAnalysis from "./components/StockAnalysis";
import StockRecommendations from "./components/StockRecommendations";
import Watchlist from "./components/Watchlist";
import StockComparison from "./components/StockComparison";
import Sidebar from "./components/Sidebar";
import PriceChart from "./components/PriceChart";
import InfoTip from "./components/InfoTip";
import Money from "./components/Money";
import Tools from "./components/Tools";
import Portfolio from "./components/Portfolio";
import ErrorBoundary from "./components/ErrorBoundary";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type TabKey =
  | "calculator"
  | "analysis"
  | "recommendations"
  | "watchlist"
  | "compare"
  | "money"
  | "tools"
  | "portfolio";

type Stock = {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
};

type StockPrice = {
  symbol: string;
  name: string;
  price: number | null;
  currency: string;
  previousClose: number | null;
  marketCap: number | null;
};

type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";

type BacktestResult = {
  symbol: string;
  currency: string;
  startDate: string;
  latestDate: string;
  latestPrice: number;
  totalInvested: number;
  totalShares: number;
  currentValue: number;
  gainLoss: number;
  gainLossPercent: number;
  totalDividendsReceived: number;
  totalTransactions: number;
  transactions: {
    date: string;
    amount: number;
    price: number;
    shares: number;
    type: string;
  }[];
  portfolioValueHistory: { date: string; value: number }[];
};

function App() {
  const [stockSearch, setStockSearch] = useState<string>("");
  const [stockSymbol, setStockSymbol] = useState<string>("");
  const [stockOptions, setStockOptions] = useState<Stock[]>([]);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const [stockPrice, setStockPrice] = useState<StockPrice | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("calculator");

  const [startDate, setStartDate] = useState<string>("");
  const [principal, setPrincipal] = useState<number>(0);
  const [recurringAmount, setRecurringAmount] = useState<number>(0);
  const [recurringFrequency, setRecurringFrequency] =
    useState<RecurringFrequency>("monthly");

  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(
    null
  );
  const [transactionPage, setTransactionPage] = useState<number>(0);
  const TRANSACTIONS_PER_PAGE = 10;

  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isPriceLoading, setIsPriceLoading] = useState<boolean>(false);
  const [isBacktesting, setIsBacktesting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function searchStocks(value: string) {
    const trimmedValue = value.trim();

    if (trimmedValue === "") {
      setStockOptions([]);
      setShowDropdown(false);
      setStockSymbol("");
      setStockPrice(null);
      setBacktestResult(null);
      return;
    }

    try {
      setIsSearching(true);
      setErrorMessage("");

      const response = await fetch(
        `${API_BASE_URL}/stocks/search?q=${encodeURIComponent(trimmedValue)}`
      );

      const data = await response.json();

      if (data.error) {
        setStockOptions([]);
        setShowDropdown(false);
        setErrorMessage("Failed to search stocks.");
        return;
      }

      setStockOptions(data);
      setShowDropdown(true);
    } catch (error) {
      console.error(error);
      setStockOptions([]);
      setShowDropdown(false);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsSearching(false);
    }
  }

  async function getStockPrice(symbol: string) {
    if (symbol.trim() === "") {
      setStockPrice(null);
      return;
    }

    try {
      setIsPriceLoading(true);
      setErrorMessage("");

      const response = await fetch(
        `${API_BASE_URL}/stocks/price?symbol=${encodeURIComponent(symbol)}`
      );

      const data = await response.json();

      if (data.error) {
        setStockPrice(null);
        setErrorMessage("Failed to get stock price.");
        return;
      }

      setStockPrice(data);
    } catch (error) {
      console.error(error);
      setStockPrice(null);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsPriceLoading(false);
    }
  }

  async function runBacktest() {
    if (stockSymbol.trim() === "") {
      setErrorMessage("Please select or enter a stock symbol.");
      return;
    }

    if (startDate === "") {
      setErrorMessage("Please select an investment start date.");
      return;
    }

    if (principal <= 0 && recurringAmount <= 0) {
      setErrorMessage("Please enter a principal amount or recurring amount.");
      return;
    }

    try {
      setIsBacktesting(true);
      setErrorMessage("");
      setBacktestResult(null);

      const response = await fetch(`${API_BASE_URL}/stocks/backtest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          symbol: stockSymbol,
          startDate: startDate,
          principal: principal,
          recurringAmount: recurringAmount,
          recurringFrequency: recurringFrequency
        })
      });

      const data = await response.json();

      console.log("Backtest data:", data);
      console.log("Transactions:", data.transactions);

      if (data.error) {
        setErrorMessage(data.error);
        return;
      }

      setBacktestResult(data);
      setTransactionPage(0);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsBacktesting(false);
    }
  }

  function handleSelectStock(stock: Stock) {
    setStockSymbol(stock.symbol);
    setStockSearch(`${stock.symbol} - ${stock.name}`);
    setShowDropdown(false);
    setBacktestResult(null);
    getStockPrice(stock.symbol);
  }

  function handleSelectSymbolFromWatchlist(symbol: string) {
    setStockSymbol(symbol);
    setStockSearch(symbol);
    setShowDropdown(false);
    setBacktestResult(null);
    getStockPrice(symbol);
    setActiveTab("analysis");
  }

  function formatMarketCap(value: number | null) {
    if (value === null) {
      return "N/A";
    }

    if (value >= 1_000_000_000_000) {
      return `${(value / 1_000_000_000_000).toFixed(2)}T`;
    }

    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    }

    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    }

    return value.toString();
  }

  function formatMoney(value: number, currency: string) {
    return `${currency ? currency + " " : ""}${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function handleDownloadTransactionsCsv() {
    if (!backtestResult || !backtestResult.transactions?.length) {
      return;
    }

    const header = ["No.", "Date", "Type", "Amount", "Price", "Shares", "Currency"];

    const rows = backtestResult.transactions.map((transaction, index) => [
      String(index + 1),
      transaction.date,
      transaction.type,
      transaction.amount.toFixed(2),
      transaction.price.toFixed(4),
      transaction.shares.toFixed(6),
      backtestResult.currency,
    ]);

    // Quote every field and escape embedded quotes -- transaction "type" can
    // contain a comma (e.g. "initial + monthly"), which would otherwise break
    // column alignment when opened in a spreadsheet.
    const csvContent = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${backtestResult.symbol}_backtest_${backtestResult.startDate}_to_${backtestResult.latestDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />

      <div className="card">
        {/* Keyed by tab so a crash in one tab resets when the user navigates away. */}
        <ErrorBoundary key={activeTab}>
        <h1>Finance Backtester</h1>

        <p className="intro-text">
          Search a stock, choose when you started investing, then enter your initial and recurring investment amount.
        </p>

        <div className="field-group stock-search-box">
        <label className="field-label">
          Stock
          <InfoTip text="Search by ticker symbol like AAPL, TSLA, D05.SI, or by company name like Apple or DBS." />
        </label>

        <input
          type="text"
          placeholder="Enter stock symbol or company name"
          value={stockSearch}
          onChange={(e) => {
            const value = e.target.value;
            setStockSearch(value);
            setStockSymbol(value.toUpperCase());
            setBacktestResult(null);
            searchStocks(value);
          }}
        />

        {isSearching && <p className="helper-text">Searching...</p>}

        {showDropdown && stockOptions.length > 0 && (
          <ul className="dropdown">
            {stockOptions.map((stock) => (
              <li key={stock.symbol} onClick={() => handleSelectStock(stock)}>
                <strong>{stock.symbol}</strong> - {stock.name}
                <br />
                <small>
                  {stock.exchange} | {stock.quoteType}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isPriceLoading && <p className="helper-text">Loading price...</p>}

      {stockPrice && (
        <div className="price-card">
          <div>
            <p className="stock-name">{stockPrice.name}</p>
            <p className="stock-price">
              {stockPrice.price !== null
                ? formatMoney(stockPrice.price, stockPrice.currency)
                : "N/A"}
            </p>
          </div>

          <div className="price-details">
            <p>
              <strong>Symbol:</strong> {stockPrice.symbol}
            </p>

            <p>
              <strong>Previous Close:</strong>{" "}
              {stockPrice.previousClose !== null
                ? formatMoney(stockPrice.previousClose, stockPrice.currency)
                : "N/A"}
            </p>

            <p>
              <strong>Market Cap:</strong> {formatMarketCap(stockPrice.marketCap)}
            </p>
          </div>
        </div>
      )}

      {activeTab === "analysis" && (
        <>
          {stockPrice ? (
            <StockAnalysis symbol={stockSymbol} />
          ) : (
            <p className="empty-text">
              Search and select a stock above to see its analysis.
            </p>
          )}
        </>
      )}

      {activeTab === "recommendations" && <StockRecommendations />}

      {activeTab === "watchlist" && <Watchlist onSelectSymbol={handleSelectSymbolFromWatchlist} />}

      {activeTab === "compare" && <StockComparison />}

      {activeTab === "money" && <Money />}

      {activeTab === "tools" && <Tools />}

      {activeTab === "portfolio" && <Portfolio />}

      {activeTab === "calculator" && (
        <>
      <div className="input-row">
        <div className="field-group">
          <label className="field-label">
            Start Date
            <InfoTip text="Choose the date you want the backtest to begin. If the market was closed or the stock did not exist yet, the app uses the next available trading day." />
          </label>

          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setBacktestResult(null);
            }}
          />
        </div>

        <div className="field-group">
          <label className="field-label">
            Principal Amount
            <InfoTip text="This is your first lump-sum investment. Example: if you started with $1,000, enter 1000." />
          </label>

          <input
            type="number"
            placeholder="Principal amount"
            value={principal === 0 ? "" : principal}
            onChange={(e) => {
              setPrincipal(Number(e.target.value));
              setBacktestResult(null);
            }}
          />
        </div>
      </div>

      <div className="input-row">
        <div className="field-group">
          <label className="field-label">
            Recurring Amount
            <InfoTip text="This is the extra amount invested repeatedly. Example: enter 100 if you invest $100 every week or month." />
          </label>

          <input
            type="number"
            placeholder="Recurring amount"
            value={recurringAmount === 0 ? "" : recurringAmount}
            onChange={(e) => {
              setRecurringAmount(Number(e.target.value));
              setBacktestResult(null);
            }}
          />
        </div>

        <div className="field-group">
          <label className="field-label">
            Frequency
            <InfoTip text="Choose how often the recurring amount is invested: daily, weekly, monthly, or yearly. If the selected date is not a trading day, the app uses the next available trading day." />
          </label>
          <select
            value={recurringFrequency}
            onChange={(e) => {
              setRecurringFrequency(e.target.value as RecurringFrequency);
              setBacktestResult(null);
            }}
          >
            <option value="daily">Invest daily</option>
            <option value="weekly">Invest weekly</option>
            <option value="monthly">Invest monthly</option>
            <option value="yearly">Invest yearly</option>
          </select>

        </div>
      </div>

        <button onClick={runBacktest} disabled={isBacktesting}>
          {isBacktesting ? "Calculating..." : "Calculate Backtest"}
        </button>

        {errorMessage && <p className="error-text">{errorMessage}</p>}

        {backtestResult && (
          <div className="result-card">
            <div className="result-header">
              <div>
                <h2>Backtest Result</h2>
                <p className="result-subtitle">
                  {backtestResult.symbol} • {backtestResult.startDate} to{" "}
                  {backtestResult.latestDate}
                </p>
              </div>
            </div>

            {backtestResult.portfolioValueHistory.length > 1 && (
              <div>
                <h3>Portfolio Value Over Time</h3>
                <PriceChart
                  data={backtestResult.portfolioValueHistory.map((point) => ({
                    date: point.date,
                    close: point.value,
                  }))}
                />
              </div>
            )}

            <div className="summary-grid">
              <div className="summary-tile">
                <span className="summary-label">Total Invested</span>
                <strong>
                  {formatMoney(
                    backtestResult.totalInvested,
                    backtestResult.currency
                  )}
                </strong>
              </div>

              <div className="summary-tile">
                <span className="summary-label">Current Value</span>
                <strong>
                  {formatMoney(
                    backtestResult.currentValue,
                    backtestResult.currency
                  )}
                </strong>
              </div>

              <div className="summary-tile">
                <span className="summary-label">Total Shares</span>
                <strong>{backtestResult.totalShares}</strong>
              </div>

              <div className="summary-tile">
                <span className="summary-label">Latest Price</span>
                <strong>
                  {formatMoney(
                    backtestResult.latestPrice,
                    backtestResult.currency
                  )}
                </strong>
              </div>
            </div>

            <div
              className={`gain-loss-banner ${
                backtestResult.gainLoss >= 0 ? "positive" : "negative"
              }`}
            >
              <span>Gain / Loss</span>
              <strong>
                {formatMoney(backtestResult.gainLoss, backtestResult.currency)} (
                {backtestResult.gainLossPercent}%)
              </strong>
            </div>

            <div className="details-grid">
              <div className="detail-box">
                <span className="detail-label">Buy Transactions</span>
                <strong>{backtestResult.totalTransactions}</strong>
              </div>

              <div className="detail-box">
                <span className="detail-label">Currency</span>
                <strong>{backtestResult.currency || "N/A"}</strong>
              </div>

              <div className="detail-box">
                <span className="detail-label">Total Dividends Received</span>
                <strong>
                  {formatMoney(
                    backtestResult.totalDividendsReceived,
                    backtestResult.currency
                  )}
                </strong>
              </div>
            </div>

            <div className="transaction-history-header">
              <div>
                <h3>Transaction History</h3>
                <p>
                  Showing {backtestResult.transactions?.length ?? 0} of{" "}
                  {backtestResult.totalTransactions} transactions
                </p>
              </div>

              {backtestResult.transactions && backtestResult.transactions.length > 0 && (
                <button
                  type="button"
                  className="csv-download-button"
                  onClick={handleDownloadTransactionsCsv}
                >
                  Download CSV
                </button>
              )}
            </div>

            {backtestResult.transactions && backtestResult.transactions.length > 0 ? (
              <>
                <p className="table-scroll-hint">Swipe left/right to see more →</p>
                <div className="backtest-table-container">
                  <table className="backtest-table">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Price</th>
                        <th>Shares</th>
                      </tr>
                    </thead>

                    <tbody>
                      {backtestResult.transactions
                        .slice(
                          transactionPage * TRANSACTIONS_PER_PAGE,
                          (transactionPage + 1) * TRANSACTIONS_PER_PAGE
                        )
                        .map((transaction, index) => (
                          <tr key={`${transaction.date}-${index}`}>
                            <td>
                              {transactionPage * TRANSACTIONS_PER_PAGE + index + 1}
                            </td>
                            <td>{transaction.date}</td>
                            <td>
                              <span className="transaction-type">{transaction.type}</span>
                            </td>
                            <td>{formatMoney(transaction.amount, backtestResult.currency)}</td>
                            <td>{formatMoney(transaction.price, backtestResult.currency)}</td>
                            <td>{transaction.shares.toFixed(4)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {backtestResult.transactions.length > TRANSACTIONS_PER_PAGE && (
                  <div className="pagination">
                    <button
                      type="button"
                      onClick={() => setTransactionPage((page) => Math.max(0, page - 1))}
                      disabled={transactionPage === 0}
                    >
                      Previous
                    </button>

                    <span className="pagination-label">
                      Page {transactionPage + 1} of{" "}
                      {Math.ceil(
                        backtestResult.transactions.length / TRANSACTIONS_PER_PAGE
                      )}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        setTransactionPage((page) =>
                          Math.min(
                            Math.ceil(
                              backtestResult.transactions.length /
                                TRANSACTIONS_PER_PAGE
                            ) - 1,
                            page + 1
                          )
                        )
                      }
                      disabled={
                        transactionPage >=
                        Math.ceil(
                          backtestResult.transactions.length / TRANSACTIONS_PER_PAGE
                        ) -
                          1
                      }
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="empty-text">
                No transaction details were returned by the backend.
              </p>
            )}
          </div>
        )}
        </>
      )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;