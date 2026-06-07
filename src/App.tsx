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

type RecurringFrequency = "weekly" | "monthly";

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

        <div className="stock-search-box">
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
            <p className="stock-name">{stockPrice.name}</p>

            <p className="stock-price">
              {stockPrice.price !== null ? stockPrice.price : "N/A"}{" "}
              {stockPrice.currency}
            </p>

            <div className="price-details">
              <p>Symbol: {stockPrice.symbol}</p>
              <p>
                Previous Close:{" "}
                {stockPrice.previousClose !== null
                  ? stockPrice.previousClose
                  : "N/A"}
              </p>
              <p>Market Cap: {formatMarketCap(stockPrice.marketCap)}</p>
            </div>
          </div>
        )}

        <div className="input-row">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setBacktestResult(null);
            }}
          />

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

        <div className="input-row">
          <input
            type="number"
            placeholder="Recurring amount"
            value={recurringAmount === 0 ? "" : recurringAmount}
            onChange={(e) => {
              setRecurringAmount(Number(e.target.value));
              setBacktestResult(null);
            }}
          />

          <select
            value={recurringFrequency}
            onChange={(e) => {
              setRecurringFrequency(e.target.value as RecurringFrequency);
              setBacktestResult(null);
            }}
          >
            <option value="monthly">Invest monthly</option>
            <option value="weekly">Invest weekly</option>
          </select>
        </div>

        <button onClick={runBacktest} disabled={isBacktesting}>
          {isBacktesting ? "Calculating..." : "Calculate Backtest"}
        </button>

        {errorMessage && <p className="error-text">{errorMessage}</p>}

        {backtestResult && (
          <div className="result-card">
            <h2>Backtest Result</h2>

            <p>
              <strong>Stock:</strong> {backtestResult.symbol}
            </p>

            <p>
              <strong>Period:</strong> {backtestResult.startDate} to{" "}
              {backtestResult.latestDate}
            </p>

            <p>
              <strong>Latest Price:</strong>{" "}
              {formatMoney(
                backtestResult.latestPrice,
                backtestResult.currency
              )}
            </p>

            <hr />

            <p>
              <strong>Total Invested:</strong>{" "}
              {formatMoney(
                backtestResult.totalInvested,
                backtestResult.currency
              )}
            </p>

            <p>
              <strong>Total Shares:</strong> {backtestResult.totalShares}
            </p>

            <p>
              <strong>Current Value:</strong>{" "}
              {formatMoney(
                backtestResult.currentValue,
                backtestResult.currency
              )}
            </p>

            <p>
              <strong>Gain/Loss:</strong>{" "}
              {formatMoney(backtestResult.gainLoss, backtestResult.currency)} (
              {backtestResult.gainLossPercent}%)
            </p>

            <p>
              <strong>Total Buy Transactions:</strong>{" "}
              {backtestResult.totalTransactions}
            </p>

            <h3>Latest Transactions</h3>

            <div className="transactions-list">
            {backtestResult.transactions.map((transaction, index) => (
              <div key={index} className="transaction-row">
                <p>
                  <strong>{index + 1}.</strong> {transaction.date} | {transaction.type}
                </p>

                <p>
                  Invested:{" "}
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