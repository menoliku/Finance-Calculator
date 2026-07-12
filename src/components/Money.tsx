import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";
import InfoTip from "./InfoTip";
import BudgetSettings from "./BudgetSettings";
import NetWorthCard from "./NetWorthCard";
import GoalsCard from "./GoalsCard";
import { EXPENSE_CATEGORIES } from "../lib/moneyCategories";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const INCOME_CATEGORY = "Income";

type TransactionType = "income" | "expense";

type MoneyTransaction = {
  id: number;
  date: string;
  type: TransactionType;
  category: string;
  amount: number;
  note: string | null;
};

type CategorySummary = {
  category: string;
  spent: number;
  budget: number | null;
};

type MoneySummary = {
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRate: number;
  categories: CategorySummary[];
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function Money() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!getToken());
  const [month, setMonth] = useState<string>(currentMonth());
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [transactions, setTransactions] = useState<MoneyTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [txDate, setTxDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [txType, setTxType] = useState<TransactionType>("expense");
  const [txCategory, setTxCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [txAmount, setTxAmount] = useState<string>("");
  const [txNote, setTxNote] = useState<string>("");
  const [isAdding, setIsAdding] = useState<boolean>(false);

  async function loadMoneyData() {
    if (!getToken()) {
      setIsLoggedIn(false);
      setSummary(null);
      setTransactions([]);
      return;
    }

    setIsLoggedIn(true);

    try {
      setIsLoading(true);
      setErrorMessage("");

      const [summaryResponse, transactionsResponse] = await Promise.all([
        authFetch(`${API_BASE_URL}/money/summary?month=${month}`),
        authFetch(`${API_BASE_URL}/money/transactions?month=${month}`),
      ]);

      if (!summaryResponse.ok || !transactionsResponse.ok) {
        throw new Error("Failed to load money data.");
      }

      const summaryData = await summaryResponse.json();
      const transactionsData = await transactionsResponse.json();

      setSummary(summaryData);
      setTransactions(transactionsData.transactions);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMoneyData();
    const unsubscribe = onAuthChange(loadMoneyData);
    return unsubscribe;
  }, [month]);

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();

    const amount = Number(txAmount);

    if (!amount || amount <= 0) {
      setErrorMessage("Please enter an amount greater than zero.");
      return;
    }

    try {
      setIsAdding(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: txDate,
          type: txType,
          category: txType === "income" ? INCOME_CATEGORY : txCategory,
          amount,
          note: txNote.trim() === "" ? null : txNote.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not add that transaction.");
      }

      setTxAmount("");
      setTxNote("");
      await loadMoneyData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not add that transaction."
      );
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDeleteTransaction(id: number) {
    try {
      const response = await authFetch(`${API_BASE_URL}/money/transactions/${id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error("Could not delete that transaction.");
      }

      await loadMoneyData();
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not delete that transaction.");
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Money</h2>
          <p className="result-subtitle">
            Track income, expenses, and net worth in one place.
          </p>
        </div>
        <p className="empty-text">Sign in from the menu to start tracking your money.</p>
      </div>
    );
  }

  return (
    <div className="money-module">
      <div className="result-card">
        <div className="result-header">
          <div>
            <h2>Money</h2>
            <p className="result-subtitle">
              See where your money goes and what you're building.
            </p>
          </div>

          <input
            type="month"
            className="money-month-picker"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>

        {errorMessage && <p className="error-text">{errorMessage}</p>}

        {isLoading && !summary ? (
          <p className="helper-text">Loading...</p>
        ) : (
          summary && (
            <>
              <div className="summary-grid">
                <div className="summary-tile">
                  <span className="summary-label">Income</span>
                  <strong>{formatCurrency(summary.totalIncome)}</strong>
                </div>

                <div className="summary-tile">
                  <span className="summary-label">Expenses</span>
                  <strong>{formatCurrency(summary.totalExpenses)}</strong>
                </div>

                <div className="summary-tile">
                  <span className="summary-label">
                    Cash Flow
                    <InfoTip text="Income minus expenses for the month. Positive means you added to your savings; negative means you spent more than you earned." />
                  </span>
                  <strong className={summary.netCashFlow >= 0 ? "gauge-good" : "gauge-critical"}>
                    {formatCurrency(summary.netCashFlow)}
                  </strong>
                </div>

                <div className="summary-tile">
                  <span className="summary-label">
                    Savings Rate
                    <InfoTip text="The share of your income you kept instead of spent. A common beginner target is at least 20%." />
                  </span>
                  <strong>{Math.round(summary.savingsRate * 100)}%</strong>
                </div>
              </div>

              <h3 className="money-section-title">
                Spending by Category
                <InfoTip text="Set a monthly budget per category below to see how actual spending compares." />
              </h3>

              <div className="money-budget-bars">
                {summary.categories
                  .filter((c) => c.spent > 0 || c.budget !== null)
                  .map((c) => {
                    const percent = c.budget ? Math.min(100, (c.spent / c.budget) * 100) : 0;
                    const isOverBudget = c.budget !== null && c.spent > c.budget;

                    return (
                      <div key={c.category} className="money-budget-row">
                        <div className="money-budget-row-label">
                          <span>{c.category}</span>
                          <span className={isOverBudget ? "gauge-critical" : "helper-text"}>
                            {formatCurrency(c.spent)}
                            {c.budget !== null ? ` / ${formatCurrency(c.budget)}` : ""}
                          </span>
                        </div>
                        {c.budget !== null && (
                          <div className="money-budget-track">
                            <div
                              className={`money-budget-fill ${isOverBudget ? "over-budget" : ""}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}

                {summary.categories.every((c) => c.spent === 0 && c.budget === null) && (
                  <p className="empty-text">No spending recorded for this month yet.</p>
                )}
              </div>
            </>
          )
        )}

        <h3 className="money-section-title">Add a Transaction</h3>

        <form className="money-add-form" onSubmit={handleAddTransaction}>
          <div className="input-row">
            <div className="field-group">
              <label className="field-label">Type</label>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as TransactionType)}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>

            <div className="field-group">
              <label className="field-label">Date</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
              />
            </div>
          </div>

          <div className="input-row">
            {txType === "expense" && (
              <div className="field-group">
                <label className="field-label">Category</label>
                <select value={txCategory} onChange={(e) => setTxCategory(e.target.value)}>
                  {EXPENSE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field-group">
              <label className="field-label">Amount</label>
              <input
                type="number"
                placeholder="0.00"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. Groceries at Trader Joe's"
              value={txNote}
              onChange={(e) => setTxNote(e.target.value)}
            />
          </div>

          <button type="submit" disabled={isAdding}>
            {isAdding ? "Adding..." : "Add Transaction"}
          </button>
        </form>

        <h3 className="money-section-title">Transactions</h3>

        {transactions.length > 0 ? (
          <div className="money-transaction-list">
            {transactions.map((t) => (
              <div key={t.id} className="money-transaction-row">
                <div>
                  <strong>{t.category}</strong>
                  <p className="helper-text">
                    {t.date}
                    {t.note ? ` • ${t.note}` : ""}
                  </p>
                </div>

                <div className="money-transaction-amount">
                  <span className={t.type === "income" ? "gauge-good" : ""}>
                    {t.type === "income" ? "+" : "-"}
                    {formatCurrency(t.amount)}
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
        ) : (
          <p className="empty-text">No transactions yet for this month.</p>
        )}
      </div>

      <BudgetSettings />
      <NetWorthCard />
      <GoalsCard />
    </div>
  );
}
