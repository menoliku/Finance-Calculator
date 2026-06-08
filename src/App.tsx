import { useState } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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
  totalTransactions: number;
  transactions: {
    date: string;
    amount: number;
    price: number;
    shares: number;
    type: string;
  }[];
};

type InfoTipProps = {
  text: string;
};

function InfoTip({ text }: InfoTipProps) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      ?
    </span>
  );
}

function App() {
  const [stockSearch, setStockSearch] = useState<string>("");
  const [stockSymbol, setStockSymbol] = useState<string>("");
  const [stockOptions, setStockOptions] = useState<Stock[]>([]);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const [stockPrice, setStockPrice] = useState<StockPrice | null>(null);

  const [startDate, setStartDate] = useState<string>("");
  const [principal, setPrincipal] = useState<number>(0);
  const [recurringAmount, setRecurringAmount] = useState<number>(0);
  const [recurringFrequency, setRecurringFrequency] =
    useState<RecurringFrequency>("monthly");

  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(
    null
  );

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

      if (data.error) {
        setErrorMessage(data.error);
        return;
      }

      setBacktestResult(data);
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

  return (
    <div className="page">
      <div className="card">
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
            </div>

            <h3>Transaction History</h3>

            <div className="transactions-list">
              {backtestResult.transactions.map((transaction, index) => (
                <div key={index} className="transaction-row">
                  <div className="transaction-top">
                    <strong>#{index + 1}</strong>
                    <span>{transaction.date}</span>
                  </div>

                  <p>
                    <strong>{transaction.type}</strong>
                  </p>

                  <p>
                    Invested{" "}
                    {formatMoney(transaction.amount, backtestResult.currency)} at{" "}
                    {formatMoney(transaction.price, backtestResult.currency)}
                  </p>

                  <small>Shares bought: {transaction.shares}</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;