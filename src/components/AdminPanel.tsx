import { useEffect, useState } from "react";
import { authFetch, getToken, onAuthChange } from "../auth";
import { TIERS, TIER_LABELS, type Tier } from "../lib/tiers";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type AdminUser = {
  id: number;
  username: string;
  email: string;
  subscriptionTier: Tier;
  role: "user" | "developer";
};

export default function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isDeveloper, setIsDeveloper] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);

  async function loadUsers() {
    if (!getToken()) {
      setIsDeveloper(false);
      setUsers([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/admin/users`);

      if (response.status === 403) {
        setIsDeveloper(false);
        setUsers([]);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load users.");
      }

      const data = await response.json();
      setIsDeveloper(true);
      setUsers(data.users);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
    const unsubscribe = onAuthChange(loadUsers);
    return unsubscribe;
  }, []);

  async function handleSetTier(userId: number, tier: Tier) {
    try {
      setUpdatingUserId(userId);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/admin/users/${userId}/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      if (!response.ok) {
        throw new Error("Could not update that user's plan.");
      }

      const updated = await response.json();
      setUsers((prev) =>
        prev.map((u) =>
          u.id === updated.id ? { ...u, subscriptionTier: updated.subscriptionTier } : u
        )
      );
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not update that user's plan.");
    } finally {
      setUpdatingUserId(null);
    }
  }

  if (!isLoading && !isDeveloper) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Admin</h2>
          <p className="result-subtitle">Manage beta testers and their plans.</p>
        </div>
        <div className="locked-feature">
          <p>
            {getToken()
              ? "This area is for developers. Enter a developer code from the account menu."
              : "Sign in with a developer account to manage users."}
          </p>
          <span className="tier-badge tier-badge-dev">Developer</span>
        </div>
      </div>
    );
  }

  return (
    <div className="result-card">
      <div className="result-header">
        <div>
          <h2>Admin — Users</h2>
          <p className="result-subtitle">
            Grant beta testers access to paid plans. Changes apply immediately.
          </p>
        </div>
      </div>

      {errorMessage && <p className="error-text">{errorMessage}</p>}

      {isLoading ? (
        <p className="helper-text">Loading users...</p>
      ) : (
        <div className="backtest-table-container">
          <table className="backtest-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Plan</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    {u.role === "developer" ? (
                      <span className="tier-badge tier-badge-dev">Dev</span>
                    ) : (
                      "User"
                    )}
                  </td>
                  <td>
                    <div className="tier-picker-options admin-tier-options">
                      {TIERS.map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          className={`tier-picker-option ${
                            u.subscriptionTier === tier ? "active" : ""
                          }`}
                          onClick={() => handleSetTier(u.id, tier)}
                          disabled={updatingUserId === u.id}
                        >
                          {TIER_LABELS[tier]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
