import { useEffect, useState } from "react";
import {
  authHeaders,
  getToken,
  notifyAuthChange,
  setToken as persistToken,
} from "../auth";
import { TIERS, TIER_LABELS, type Tier } from "../lib/tiers";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type CurrentUser = {
  id: number;
  username: string;
  email: string;
  subscriptionTier: Tier;
  billingEnabled: boolean;
};

type AuthMode = "login" | "register" | null;

export default function AuthPanel() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [mode, setMode] = useState<AuthMode>(null);

  const [username, setUsername] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const [formError, setFormError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isUpgrading, setIsUpgrading] = useState<boolean>(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    if (!token) {
      setUser(null);
      return;
    }

    async function loadCurrentUser() {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: authHeaders(),
        });

        if (!response.ok) {
          throw new Error("Session expired");
        }

        const data = await response.json();

        if (!isCancelled) {
          setUser(data);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error(error);
          persistToken(null);
          setTokenState(null);
          setUser(null);
        }
      }
    }

    loadCurrentUser();

    return () => {
      isCancelled = true;
    };
  }, [token]);

  function resetForm() {
    setUsername("");
    setEmail("");
    setPassword("");
    setFormError("");
  }

  function openModal(nextMode: AuthMode) {
    resetForm();
    setMode(nextMode);
  }

  function closeModal() {
    resetForm();
    setMode(null);
  }

  async function login(loginEmail: string, loginPassword: string) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Invalid email or password.");
    }

    persistToken(data.access_token);
    setTokenState(data.access_token);
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (email.trim() === "" || password === "") {
      setFormError("Please enter your email and password.");
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError("");
      await login(email, password);
      closeModal();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (username.trim() === "" || email.trim() === "" || password === "") {
      setFormError("Please fill in username, email, and password.");
      return;
    }

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError("");

      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not create account.");
      }

      // Log the new account in immediately so signup feels like one step.
      await login(email, password);
      closeModal();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not create account."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogout() {
    persistToken(null);
    setTokenState(null);
    setUser(null);
    setIsConfirmingDelete(false);
  }

  async function handleDeleteAccount() {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    try {
      setIsDeleting(true);

      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error("Could not delete account.");
      }

      handleLogout();
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  }

  async function handleSelectTier(tier: Tier) {
    if (!user || tier === user.subscriptionTier) {
      return;
    }

    try {
      setIsUpgrading(true);

      const response = await fetch(`${API_BASE_URL}/auth/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tier }),
      });

      if (!response.ok) {
        throw new Error("Could not update subscription.");
      }

      const data = await response.json();
      setUser(data);
      notifyAuthChange(); // subscription tier changed -- tell other components to refetch
    } catch (error) {
      console.error(error);
    } finally {
      setIsUpgrading(false);
    }
  }

  return (
    <div className="sidebar-auth">
      {user ? (
        <>
          <div className="sidebar-auth-identity">
            <span className="auth-greeting">Hi, {user.username}</span>
            <span className={`tier-badge tier-badge-${user.subscriptionTier}`}>
              {TIER_LABELS[user.subscriptionTier] ?? "Free"}
            </span>
          </div>

          <div className="tier-picker">
            <span className="tier-picker-label">Plan</span>
            <div className="tier-picker-options">
              {TIERS.map((tier) => {
                const isLocked = tier !== "free" && !user.billingEnabled;

                return (
                  <button
                    key={tier}
                    type="button"
                    className={`tier-picker-option ${
                      user.subscriptionTier === tier ? "active" : ""
                    }`}
                    onClick={() => handleSelectTier(tier)}
                    disabled={isUpgrading || isLocked}
                    title={isLocked ? "Paid plans are coming soon" : undefined}
                  >
                    {TIER_LABELS[tier]}
                    {isLocked && <span className="tier-picker-soon">Soon</span>}
                  </button>
                );
              })}
            </div>
            {!user.billingEnabled && (
              <p className="tier-picker-note">
                Paid plans launch soon — enjoy the beta for free.
              </p>
            )}
          </div>

          <button
            type="button"
            className="auth-link-button sidebar-auth-button"
            onClick={handleLogout}
          >
            Log Out
          </button>

          {isConfirmingDelete && (
            <p className="helper-text">
              This permanently deletes your account and watchlist. Click again to confirm.
            </p>
          )}

          <button
            type="button"
            className="auth-link-button sidebar-auth-button auth-link-button-danger"
            onClick={handleDeleteAccount}
            disabled={isDeleting}
          >
            {isDeleting
              ? "Deleting..."
              : isConfirmingDelete
              ? "Confirm Delete Account"
              : "Delete Account"}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="auth-link-button sidebar-auth-button"
            onClick={() => openModal("login")}
          >
            Sign In
          </button>
          <button
            type="button"
            className="auth-link-button auth-link-button-primary sidebar-auth-button"
            onClick={() => openModal("register")}
          >
            Sign Up
          </button>
        </>
      )}

      {mode && (
        <div className="auth-modal-overlay" onClick={closeModal}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-header">
              <h2>{mode === "login" ? "Sign In" : "Create Account"}</h2>
              <button
                type="button"
                className="auth-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={mode === "login" ? handleLoginSubmit : handleRegisterSubmit}
            >
              {mode === "register" && (
                <div className="field-group">
                  <label className="field-label">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                  />
                </div>
              )}

              <div className="field-group">
                <label className="field-label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="field-group">
                <label className="field-label">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
              </div>

              {formError && <p className="error-text">{formError}</p>}

              <button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Please wait..."
                  : mode === "login"
                  ? "Sign In"
                  : "Create Account"}
              </button>

              <p className="auth-modal-switch">
                {mode === "login" ? (
                  <>
                    Don&apos;t have an account?{" "}
                    <button
                      type="button"
                      className="auth-link-button"
                      onClick={() => openModal("register")}
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="auth-link-button"
                      onClick={() => openModal("login")}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
