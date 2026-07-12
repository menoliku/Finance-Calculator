import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";
import { EXPENSE_CATEGORIES } from "../lib/moneyCategories";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export default function BudgetSettings() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [savedMessage, setSavedMessage] = useState<string>("");

  async function loadBudgets() {
    if (!getToken()) {
      setBudgets({});
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/budgets`);

      if (!response.ok) {
        throw new Error("Failed to load budgets.");
      }

      const data = await response.json();
      const asStrings: Record<string, string> = {};

      for (const category of EXPENSE_CATEGORIES) {
        const value = data.budgets[category];
        asStrings[category] = value !== undefined ? String(value) : "";
      }

      setBudgets(asStrings);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBudgets();
    const unsubscribe = onAuthChange(loadBudgets);
    return unsubscribe;
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    const payload: Record<string, number> = {};

    for (const category of EXPENSE_CATEGORIES) {
      const raw = budgets[category];
      if (raw !== undefined && raw.trim() !== "") {
        payload[category] = Number(raw);
      }
    }

    try {
      setIsSaving(true);
      setErrorMessage("");
      setSavedMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/budgets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgets: payload }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail || "Could not save budgets.");
      }

      setSavedMessage("Budgets saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save budgets.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="result-card">
      <div className="result-header">
        <div>
          <h2>Budgets</h2>
          <p className="result-subtitle">
            Set a monthly limit per category to see how you're tracking.
          </p>
        </div>

        <button type="button" className="auth-link-button" onClick={() => setIsOpen((v) => !v)}>
          {isOpen ? "Hide" : "Edit"}
        </button>
      </div>

      {isOpen && (
        <>
          {errorMessage && <p className="error-text">{errorMessage}</p>}
          {savedMessage && <p className="helper-text">{savedMessage}</p>}

          {isLoading ? (
            <p className="helper-text">Loading...</p>
          ) : (
            <form className="money-budget-form" onSubmit={handleSave}>
              {EXPENSE_CATEGORIES.map((category) => (
                <div className="field-group money-budget-field" key={category}>
                  <label className="field-label">{category}</label>
                  <input
                    type="number"
                    placeholder="No limit"
                    value={budgets[category] ?? ""}
                    onChange={(e) =>
                      setBudgets((prev) => ({ ...prev, [category]: e.target.value }))
                    }
                  />
                </div>
              ))}

              <button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Budgets"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
