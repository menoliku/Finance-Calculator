import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";
import InfoTip from "./InfoTip";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type ItemType = "asset" | "liability";

type NetWorthItem = {
  id: number;
  name: string;
  value: number;
  itemType: ItemType;
};

type NetWorthData = {
  items: NetWorthItem[];
  assetsTotal: number;
  liabilitiesTotal: number;
  netWorth: number;
};

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function NetWorthCard() {
  const [data, setData] = useState<NetWorthData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [name, setName] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [itemType, setItemType] = useState<ItemType>("asset");
  const [isAdding, setIsAdding] = useState<boolean>(false);

  async function loadNetWorth() {
    if (!getToken()) {
      setData(null);
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/networth`);

      if (!response.ok) {
        throw new Error("Failed to load net worth.");
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
    loadNetWorth();
    const unsubscribe = onAuthChange(loadNetWorth);
    return unsubscribe;
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();

    const numericValue = Number(value);

    if (name.trim() === "" || !(numericValue >= 0)) {
      setErrorMessage("Please enter a name and a value of 0 or more.");
      return;
    }

    try {
      setIsAdding(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/networth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), value: numericValue, item_type: itemType }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not add that item.");
      }

      setName("");
      setValue("");
      await loadNetWorth();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not add that item.");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(id: number) {
    try {
      const response = await authFetch(`${API_BASE_URL}/money/networth/${id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error("Could not remove that item.");
      }

      await loadNetWorth();
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not remove that item.");
    }
  }

  return (
    <div className="result-card">
      <div className="result-header">
        <h2>
          Net Worth
          <InfoTip text="What you own (assets) minus what you owe (liabilities). Tracking it over time is one of the best ways to see real financial progress." />
        </h2>
        <p className="result-subtitle">Add what you own and what you owe.</p>
      </div>

      {errorMessage && <p className="error-text">{errorMessage}</p>}

      {isLoading ? (
        <p className="helper-text">Loading...</p>
      ) : (
        data && (
          <div className="summary-grid">
            <div className="summary-tile">
              <span className="summary-label">Assets</span>
              <strong>{formatCurrency(data.assetsTotal)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">Liabilities</span>
              <strong>{formatCurrency(data.liabilitiesTotal)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">Net Worth</span>
              <strong className={data.netWorth >= 0 ? "gauge-good" : "gauge-critical"}>
                {formatCurrency(data.netWorth)}
              </strong>
            </div>
          </div>
        )
      )}

      <form className="money-add-form" onSubmit={handleAdd}>
        <div className="input-row">
          <div className="field-group">
            <label className="field-label">Type</label>
            <select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
            </select>
          </div>

          <div className="field-group">
            <label className="field-label">Value</label>
            <input
              type="number"
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Name</label>
          <input
            type="text"
            placeholder="e.g. Checking account, Car loan"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <button type="submit" disabled={isAdding}>
          {isAdding ? "Adding..." : "Add Item"}
        </button>
      </form>

      {data && data.items.length > 0 ? (
        <div className="money-transaction-list">
          {data.items.map((item) => (
            <div key={item.id} className="money-transaction-row">
              <div>
                <strong>{item.name}</strong>
                <p className="helper-text">{item.itemType === "asset" ? "Asset" : "Liability"}</p>
              </div>

              <div className="money-transaction-amount">
                <span className={item.itemType === "asset" ? "gauge-good" : "gauge-critical"}>
                  {formatCurrency(item.value)}
                </span>

                <button
                  type="button"
                  className="watchlist-remove-button"
                  onClick={() => handleRemove(item.id)}
                  aria-label={`Remove ${item.name}`}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-text">No assets or liabilities added yet.</p>
      )}
    </div>
  );
}
