type FinancialProfileGaugeProps = {
  stage: string;
  stageLabel: string;
};

// Mirrors the order-of-operations stages from the backend evaluation --
// position and color reflect real risk (no safety net = highest risk,
// investing = the goal state), not an invented composite score.
const STAGE_POSITIONS: Record<string, number> = {
  starter_emergency_fund: 0,
  debt_payoff: 33,
  building_emergency_fund: 67,
  investing: 100,
};

const STAGE_STATUS_CLASS: Record<string, string> = {
  starter_emergency_fund: "gauge-critical",
  debt_payoff: "gauge-critical",
  building_emergency_fund: "gauge-warning",
  investing: "gauge-good",
};

export default function FinancialProfileGauge({ stage, stageLabel }: FinancialProfileGaugeProps) {
  const position = STAGE_POSITIONS[stage] ?? 0;
  const statusClass = STAGE_STATUS_CLASS[stage] ?? "gauge-warning";

  return (
    <div className="analyst-gauge">
      <div className="analyst-gauge-marker-row" style={{ left: `${position}%` }}>
        <span className={`analyst-gauge-marker-label ${statusClass}`}>{stageLabel}</span>
        <span className={`analyst-gauge-pointer ${statusClass}`} />
      </div>

      <div className="analyst-gauge-track" />

      <div className="analyst-gauge-scale">
        <span>Starter Fund</span>
        <span>Debt Payoff</span>
        <span>Building Fund</span>
        <span>Investing</span>
      </div>
    </div>
  );
}
