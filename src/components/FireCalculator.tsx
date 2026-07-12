import { useState } from "react";
import InfoTip from "./InfoTip";
import PriceChart from "./PriceChart";
import { fireProjection, formatDollars } from "../lib/finance";

export default function FireCalculator() {
  const [expenses, setExpenses] = useState<string>("40000");
  const [withdrawalRate, setWithdrawalRate] = useState<string>("4");
  const [savings, setSavings] = useState<string>("10000");
  const [monthlySavings, setMonthlySavings] = useState<string>("500");
  const [annualReturn, setAnnualReturn] = useState<string>("7");

  const expensesNum = Math.max(0, Number(expenses) || 0);
  const withdrawalNum = Math.max(0, Number(withdrawalRate) || 0);
  const savingsNum = Math.max(0, Number(savings) || 0);
  const monthlyNum = Math.max(0, Number(monthlySavings) || 0);
  const returnNum = Math.max(0, Number(annualReturn) || 0);

  const result = fireProjection(expensesNum, withdrawalNum, savingsNum, monthlyNum, returnNum);
  const hasResult = expensesNum > 0 && withdrawalNum > 0;

  return (
    <>
      <p className="result-subtitle">
        FIRE = Financial Independence, Retire Early. Find the number where work
        becomes optional.
      </p>

      <div className="input-row">
        <div className="field-group">
          <label className="field-label">
            Annual Expenses
            <InfoTip text="What your life costs per year. Your FIRE number is based on covering this forever." />
          </label>
          <input
            type="number"
            value={expenses}
            onChange={(e) => setExpenses(e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">
            Withdrawal Rate (%)
            <InfoTip text="The share of your portfolio you withdraw each year in retirement. The classic '4% rule' comes from studies showing a 4% withdrawal survived most historical 30-year periods." />
          </label>
          <input
            type="number"
            value={withdrawalRate}
            onChange={(e) => setWithdrawalRate(e.target.value)}
          />
        </div>
      </div>

      <div className="input-row">
        <div className="field-group">
          <label className="field-label">Current Savings</label>
          <input
            type="number"
            value={savings}
            onChange={(e) => setSavings(e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">Monthly Savings</label>
          <input
            type="number"
            value={monthlySavings}
            onChange={(e) => setMonthlySavings(e.target.value)}
          />
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">
          Expected Annual Return (%)
          <InfoTip text="7% is a common long-term estimate for a broad stock index fund. Use a lower number to be more conservative." />
        </label>
        <input
          type="number"
          value={annualReturn}
          onChange={(e) => setAnnualReturn(e.target.value)}
        />
      </div>

      {hasResult && (
        <>
          <div className="summary-grid">
            <div className="summary-tile">
              <span className="summary-label">
                Your FIRE Number
                <InfoTip text="Annual expenses divided by your withdrawal rate. At 4%, that's 25x your yearly spending." />
              </span>
              <strong>{formatDollars(result.fireNumber)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">Years to Get There</span>
              <strong className={result.yearsToFire !== null ? "gauge-good" : "gauge-critical"}>
                {result.yearsToFire !== null ? `${result.yearsToFire} years` : "Not reachable"}
              </strong>
            </div>
          </div>

          {result.yearsToFire !== null ? (
            <>
              {result.series.length > 1 && (
                <PriceChart
                  data={result.series.map((point) => ({
                    date: `Year ${point.year}`,
                    close: point.value,
                  }))}
                />
              )}
              <p className="helper-text">
                Saving {formatDollars(monthlyNum)} per month, you'd reach{" "}
                {formatDollars(result.fireNumber)} in about {result.yearsToFire}{" "}
                {result.yearsToFire === 1 ? "year" : "years"} — the point where a{" "}
                {withdrawalNum}% annual withdrawal covers your expenses.
              </p>
            </>
          ) : (
            <p className="helper-text">
              At this savings rate the projection doesn't reach your FIRE number
              within 100 years. Increasing monthly savings or reducing annual
              expenses (which lowers the target itself) both help — expenses count
              twice.
            </p>
          )}
        </>
      )}
    </>
  );
}
