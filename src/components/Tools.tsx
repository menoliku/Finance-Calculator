import { useState } from "react";
import CompoundCalculator from "./CompoundCalculator";
import LoanCalculator from "./LoanCalculator";
import FireCalculator from "./FireCalculator";

type ToolKey = "compound" | "loan" | "fire";

const TOOLS: { key: ToolKey; label: string }[] = [
  { key: "compound", label: "Compound Growth" },
  { key: "loan", label: "Loan" },
  { key: "fire", label: "FIRE" },
];

export default function Tools() {
  const [activeTool, setActiveTool] = useState<ToolKey>("compound");

  return (
    <div className="result-card">
      <div className="result-header">
        <div>
          <h2>Tools</h2>
          <p className="result-subtitle">
            Free calculators to answer the big money questions.
          </p>
        </div>
      </div>

      <div className="tools-subnav">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            className={`tools-subnav-option ${activeTool === tool.key ? "active" : ""}`}
            onClick={() => setActiveTool(tool.key)}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {activeTool === "compound" && <CompoundCalculator />}
      {activeTool === "loan" && <LoanCalculator />}
      {activeTool === "fire" && <FireCalculator />}
    </div>
  );
}
