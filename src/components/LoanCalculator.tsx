import { useState } from "react";
import InfoTip from "./InfoTip";
import { loanTotals, formatDollars } from "../lib/finance";

export default function LoanCalculator() {
  const [principal, setPrincipal] = useState<string>("20000");
  const [rate, setRate] = useState<string>("6");
  const [term, setTerm] = useState<string>("5");

  const principalNum = Math.max(0, Number(principal) || 0);
  const rateNum = Math.max(0, Number(rate) || 0);
  const termNum = Math.min(50, Math.max(0, Number(term) || 0));

  const result = loanTotals(principalNum, rateNum, termNum);
  const hasResult = principalNum > 0 && termNum > 0;
  const interestIsHeavy = result.totalInterest > principalNum / 2;

  return (
    <>
      <p className="result-subtitle">
        Understand the real cost of borrowing before you sign.
      </p>

      <div className="input-row">
        <div className="field-group">
          <label className="field-label">Loan Amount</label>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">
            Annual Interest Rate (%)
            <InfoTip text="The yearly rate the lender charges (APR). Car loans and mortgages are usually single digits; credit cards are often 20%+." />
          </label>
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">
          Term (years)
          <InfoTip text="How long you take to repay. Longer terms lower the monthly payment but increase the total interest you pay." />
        </label>
        <input type="number" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>

      {hasResult && (
        <>
          <div className="summary-grid">
            <div className="summary-tile">
              <span className="summary-label">Monthly Payment</span>
              <strong>{formatDollars(result.monthlyPayment)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">Total Repaid</span>
              <strong>{formatDollars(result.totalPaid)}</strong>
            </div>

            <div className="summary-tile">
              <span className="summary-label">
                Total Interest
                <InfoTip text="The extra you pay the lender on top of the amount you borrowed." />
              </span>
              <strong className={interestIsHeavy ? "gauge-critical" : ""}>
                {formatDollars(result.totalInterest)}
              </strong>
            </div>
          </div>

          <p className="helper-text">
            Borrowing {formatDollars(principalNum)} costs {formatDollars(result.totalInterest)} in
            interest over {termNum} {termNum === 1 ? "year" : "years"}.
            {interestIsHeavy &&
              " That's more than half of what you borrowed — a shorter term or lower rate would save a lot."}
          </p>
        </>
      )}
    </>
  );
}
