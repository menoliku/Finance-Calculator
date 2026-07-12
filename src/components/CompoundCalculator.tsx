import { useState } from "react";
import InfoTip from "./InfoTip";
import PriceChart from "./PriceChart";
import { compoundGrowthSeries, formatDollars } from "../lib/finance";

export default function CompoundCalculator() {
  const [initial, setInitial] = useState<string>("1000");
  const [monthly, setMonthly] = useState<string>("100");
  const [annualReturn, setAnnualReturn] = useState<string>("7");
  const [years, setYears] = useState<string>("20");

  const initialNum = Math.max(0, Number(initial) || 0);
  const monthlyNum = Math.max(0, Number(monthly) || 0);
  const returnNum = Math.max(0, Number(annualReturn) || 0);
  const yearsNum = Math.min(100, Math.max(0, Math.floor(Number(years) || 0)));

  const result = compoundGrowthSeries(initialNum, monthlyNum, returnNum, yearsNum);
  const hasResult = yearsNum > 0 && (initialNum > 0 || monthlyNum > 0);

  return (
    <>
      <p className="result-subtitle">
        See how money grows when the returns themselves start earning returns.
      </p>

      <div className="input-row">
        <div className="field-group">
          <label className="field-label">
            Starting Amount
            <InfoTip text="The money you invest today, before any monthly additions." />
          </label>
          <input
            type="number"
            value={initial}
            onChange={(e) => setInitial(e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">
            Monthly Contribution
            <InfoTip text="How much you add every month. Even small regular amounts matter more than the starting sum over long periods." />
          </label>
          <input
            type="number"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </div>
      </div>

      <div className="input-row">
        <div className="field-group">
          <label className="field-label">
            Expected Annual Return (%)
            <InfoTip text="7% is a common long-term estimate for a broad stock index fund after inflation. Savings accounts are far lower; individual stocks vary widely." />
          </label>
          <input
            type="number"
            value={annualReturn}
            onChange={(e) => setAnnualReturn(e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">Years</label>
          <input
            type="number"
            value={years}
            onChange={(e) => setYears(e.target.value)}
          />
        </div>
      </div>

      {hasResult && (
        <>
          <div className="summary-grid">
            <div className="summary-tile">
              <span className="summary-label">Final Value</span>
              <strong>{formatDollars(result.finalValue)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">You Put In</span>
              <strong>{formatDollars(result.totalContributed)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">
                Growth Earned
                <InfoTip text="The part of the final value your money earned by itself -- this is compound interest at work." />
              </span>
              <strong className="gauge-good">{formatDollars(result.interestEarned)}</strong>
            </div>
          </div>

          <PriceChart
            data={result.series.map((point) => ({
              date: `Year ${point.year}`,
              close: point.value,
            }))}
          />

          <p className="helper-text">
            After {yearsNum} years, {formatDollars(result.interestEarned)} of your{" "}
            {formatDollars(result.finalValue)} balance is growth your money earned by
            itself — not money you deposited.
          </p>
        </>
      )}
    </>
  );
}
