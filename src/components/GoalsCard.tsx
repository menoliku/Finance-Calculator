import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";
import InfoTip from "./InfoTip";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type Goal = {
  id: number;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
};

type GoalsData = {
  goals: Goal[];
  limit: number | null;
};

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function GoalsCard() {
  const [data, setData] = useState<GoalsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [name, setName] = useState<string>("");
  const [targetAmount, setTargetAmount] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [isAdding, setIsAdding] = useState<boolean>(false);

  // Per-goal draft for the "update saved amount" inline input.
  const [savedDrafts, setSavedDrafts] = useState<Record<number, string>>({});

  async function loadGoals() {
    if (!getToken()) {
      setData(null);
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/goals`);

      if (!response.ok) {
        throw new Error("Failed to load goals.");
      }

      setData(await response.json());
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGoals();
    const unsubscribe = onAuthChange(loadGoals);
    return unsubscribe;
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();

    const amount = Number(targetAmount);

    if (name.trim() === "" || !amount || amount <= 0) {
      setErrorMessage("Please enter a goal name and a target amount above zero.");
      return;
    }

    try {
      setIsAdding(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          target_amount: amount,
          target_date: targetDate === "" ? null : targetDate,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not add that goal.");
      }

      setName("");
      setTargetAmount("");
      setTargetDate("");
      await loadGoals();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not add that goal.");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleUpdateSaved(goal: Goal) {
    const draft = savedDrafts[goal.id];
    const amount = Number(draft);

    if (draft === undefined || draft.trim() === "" || !(amount >= 0)) {
      return;
    }

    try {
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_amount: amount }),
      });

      if (!response.ok) {
        throw new Error("Could not update that goal.");
      }

      setSavedDrafts((prev) => {
        const next = { ...prev };
        delete next[goal.id];
        return next;
      });
      await loadGoals();
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not update that goal.");
    }
  }

  async function handleRemove(id: number) {
    try {
      const response = await authFetch(`${API_BASE_URL}/money/goals/${id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error("Could not remove that goal.");
      }

      await loadGoals();
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not remove that goal.");
    }
  }

  const atFreeLimit =
    data?.limit !== null && data !== null && data.goals.length >= (data.limit ?? 0);

  return (
    <div className="result-card">
      <div className="result-header">
        <div>
          <h2>
            Financial Goals
            <InfoTip text="A goal is something you're saving toward, like an emergency fund or a vacation. Set a target amount and update your progress as you save." />
          </h2>
          <p className="result-subtitle">
            {data?.limit
              ? `Free plan: ${data.limit} goal. Upgrade to Plus for unlimited goals.`
              : "Set targets and watch your progress build."}
          </p>
        </div>
      </div>

      {errorMessage && <p className="error-text">{errorMessage}</p>}

      {isLoading ? (
        <p className="helper-text">Loading...</p>
      ) : data && data.goals.length > 0 ? (
        <div className="money-budget-bars">
          {data.goals.map((goal) => {
            const percent = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
            const isComplete = goal.currentAmount >= goal.targetAmount;

            return (
              <div key={goal.id} className="money-budget-row goal-row">
                <div className="money-budget-row-label">
                  <span>
                    <strong>{goal.name}</strong>
                    {goal.targetDate ? (
                      <span className="helper-text"> by {goal.targetDate}</span>
                    ) : null}
                  </span>

                  <span className={isComplete ? "gauge-good" : "helper-text"}>
                    {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                    {isComplete ? " ✓" : ""}
                  </span>
                </div>

                <div className="money-budget-track">
                  <div className="money-budget-fill" style={{ width: `${percent}%` }} />
                </div>

                <div className="goal-row-actions">
                  <input
                    type="number"
                    placeholder="Update saved amount"
                    value={savedDrafts[goal.id] ?? ""}
                    onChange={(e) =>
                      setSavedDrafts((prev) => ({ ...prev, [goal.id]: e.target.value }))
                    }
                  />
                  <button type="button" onClick={() => handleUpdateSaved(goal)}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="watchlist-remove-button"
                    onClick={() => handleRemove(goal.id)}
                    aria-label={`Delete goal ${goal.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        getToken() && <p className="empty-text">No goals yet. Add your first one below.</p>
      )}

      {!getToken() ? (
        <p className="empty-text">Sign in from the menu to set financial goals.</p>
      ) : atFreeLimit ? (
        <div className="locked-feature">
          <p>You've used your free goal. Upgrade to Plus to track unlimited goals.</p>
          <span className="tier-badge tier-badge-plus">Plus</span>
        </div>
      ) : (
        <form className="money-add-form" onSubmit={handleAdd}>
          <div className="field-group">
            <label className="field-label">Goal Name</label>
            <input
              type="text"
              placeholder="e.g. Emergency fund"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="input-row">
            <div className="field-group">
              <label className="field-label">Target Amount</label>
              <input
                type="number"
                placeholder="0.00"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label className="field-label">Target Date (optional)</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" disabled={isAdding}>
            {isAdding ? "Adding..." : "Add Goal"}
          </button>
        </form>
      )}
    </div>
  );
}
