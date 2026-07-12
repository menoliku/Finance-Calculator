import { useState } from "react";
import AuthPanel from "./AuthPanel";
import type { TabKey } from "../App";

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
            {NAV_ITEMS.map((item) => (
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
