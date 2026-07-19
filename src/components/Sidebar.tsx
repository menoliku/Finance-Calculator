import { useEffect, useState } from "react";
import AuthPanel from "./AuthPanel";
import { authFetch, getToken, onAuthChange } from "../auth";
import type { TabKey } from "../App";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type SidebarProps = {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
};

const NAV_ITEMS: { key: TabKey; label: string }[] = [
  { key: "money", label: "Money" },
  { key: "portfolio", label: "Portfolio" },
  { key: "tools", label: "Tools" },
  { key: "calculator", label: "Calculator" },
  { key: "analysis", label: "Analysis" },
  { key: "recommendations", label: "Recommendations" },
  { key: "watchlist", label: "Watchlist" },
  { key: "compare", label: "Compare" },
];

export default function Sidebar({ activeTab, onSelectTab }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeveloper, setIsDeveloper] = useState(false);

  // The Admin nav item only exists for developer accounts.
  useEffect(() => {
    async function checkRole() {
      if (!getToken()) {
        setIsDeveloper(false);
        return;
      }

      try {
        const response = await authFetch(`${API_BASE_URL}/auth/me`);
        if (!response.ok) {
          throw new Error("Session expired");
        }
        const data = await response.json();
        setIsDeveloper(data.role === "developer");
      } catch {
        setIsDeveloper(false);
      }
    }

    checkRole();
    const unsubscribe = onAuthChange(checkRole);
    return unsubscribe;
  }, []);

  const navItems = isDeveloper
    ? [...NAV_ITEMS, { key: "admin" as TabKey, label: "Admin" }]
    : NAV_ITEMS;

  function handleSelect(tab: TabKey) {
    onSelectTab(tab);
    setIsOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
      >
        <span className="sidebar-toggle-bar" />
        <span className="sidebar-toggle-bar" />
        <span className="sidebar-toggle-bar" />
      </button>

      <div
        className={`sidebar-overlay ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(false)}
        aria-hidden={!isOpen}
      >
        <div
          className={`sidebar-panel ${isOpen ? "open" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sidebar-header">
            <span className="sidebar-title">Menu</span>
            <button
              type="button"
              className="sidebar-close"
              onClick={() => setIsOpen(false)}
              aria-label="Close menu"
            >
              ×
            </button>
          </div>

          <AuthPanel />

          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sidebar-nav-item ${activeTab === item.key ? "active" : ""}`}
                onClick={() => handleSelect(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
