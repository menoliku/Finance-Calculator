import { useState } from "react";
import { authFetch, getToken } from "../auth";
import InfoTip from "./InfoTip";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type EmployerMatchStatus = "none" | "full" | "partial";

type Answers = {
  monthlyIncome: number;
  monthlyEssentialExpenses: number;
  emergencyFundBalance: number;
  hasHighInterestDebt: boolean | null;
  highInterestDebtBalance: number;
  highInterestDebtApr: number;
  monthlySavingsToEmergencyFund: number;
  monthlySavingsToInvesting: number;
  employerMatchStatus: EmployerMatchStatus | null;
};

const INITIAL_ANSWERS: Answers = {
  monthlyIncome: 0,
  monthlyEssentialExpenses: 0,
  emergencyFundBalance: 0,
  hasHighInterestDebt: null,
  highInterestDebtBalance: 0,
  highInterestDebtApr: 0,
  monthlySavingsToEmergencyFund: 0,
  monthlySavingsToInvesting: 0,
  employerMatchStatus: null,
};

type DimensionStatus = "meeting" | "below" | "well_below" | "starter_needed" | "building" | "fully_funded";

type HealthCheckResult = {
  stage: string;
  stageLabel: string;
  recommendedFocus: string;
  profileSummary: string;
  emergencyFund: {
    current: number;
    starterTarget: number;
    targetLow: number;
    targetHigh: number;
    monthsCovered: number;
    status: DimensionStatus;
  };
  debt: {
    hasHighInterestDebt: boolean;
    balance: number;
    apr: number;
    threshold: number;
  };
  savingsRate: {
    monthlyTotal: number;
    ratePercent: number;
    benchmarkPercent: number;
    status: DimensionStatus;
  };
  investmentRate: {
    monthlyAmount: number;
    ratePercent: number;
    benchmarkPercent: number;
    status: DimensionStatus;
  };
  notes: string[];
  disclaimer: string;
};

const STATUS_CLASS: Record<DimensionStatus, string> = {
  meeting: "gauge-good",
  fully_funded: "gauge-good",
  below: "gauge-warning",
  building: "gauge-warning",
  well_below: "gauge-critical",
  starter_needed: "gauge-critical",
};

function formatDollars(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

type Step = {
  key: string;
  question: string;
  helper?: string;
};

const STEPS: Step[] = [
  { key: "monthlyIncome", question: "What's your monthly take-home income?" },
  {
    key: "monthlyEssentialExpenses",
    question: "What are your essential monthly expenses?",
    helper: "Rent or mortgage, food, utilities, minimum debt payments -- the things you can't skip.",
  },
  {
    key: "emergencyFundBalance",
    question: "How much do you currently have saved specifically as an emergency fund?",
    helper: "Cash set aside for unexpected costs, separate from investments or your regular checking balance.",
  },
  {
    key: "hasHighInterestDebt",
    question: "Do you have any high-interest debt, like credit cards or personal loans?",
    helper: "Generally debt at 7% APR or higher -- most credit cards qualify.",
  },
  {
    key: "monthlySavingsSplit",
    question: "Of what you save each month, how much goes toward each?",
    helper: "This split matters -- market investments can lose value right when you might need emergency cash.",
  },
  {
    key: "employerMatchStatus",
    question: "Does your employer offer a retirement match?",
    helper: "An employer match is free money -- worth knowing if you're leaving any on the table.",
  },
];

export default function FinancialHealthCheck() {
  const [isStarted, setIsStarted] = useState<boolean>(false);
  const [step, setStep] = useState<number>(0);
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [result, setResult] = useState<HealthCheckResult | null>(null);

  const currentStep = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  function isStepAnswered(): boolean {
    if (currentStep.key === "hasHighInterestDebt") {
      return answers.hasHighInterestDebt !== null;
    }
    if (currentStep.key === "employerMatchStatus") {
      return answers.employerMatchStatus !== null;
    }
    return true; // 0 is a valid answer for every numeric question here
  }

  function goNext() {
    if (isLastStep) {
      void submit();
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  function startOver() {
    setAnswers(INITIAL_ANSWERS);
    setStep(0);
    setResult(null);
    setErrorMessage("");
    setIsStarted(true);
  }

  async function submit() {
    try {
      setIsSubmitting(true);
      setErrorMessage("");

      const response = await authFetch(`${API_BASE_URL}/money/financial-health-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyIncome: answers.monthlyIncome,
          monthlyEssentialExpenses: answers.monthlyEssentialExpenses,
          emergencyFundBalance: answers.emergencyFundBalance,
          highInterestDebtBalance: answers.hasHighInterestDebt ? answers.highInterestDebtBalance : 0,
          highInterestDebtApr: answers.hasHighInterestDebt ? answers.highInterestDebtApr : 0,
          monthlySavingsToEmergencyFund: answers.monthlySavingsToEmergencyFund,
          monthlySavingsToInvesting: answers.monthlySavingsToInvesting,
          employerMatchStatus: answers.employerMatchStatus,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not run the check-up.");
      }

      setResult(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Cannot connect to backend.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!getToken()) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Financial Health Check</h2>
          <p className="result-subtitle">
            See where you stand and what to focus on next.
          </p>
        </div>
        <p className="empty-text">Sign in from the menu to run a financial health check.</p>
      </div>
    );
  }

  if (!isStarted && !result) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Financial Health Check</h2>
          <p className="result-subtitle">
            Answer a few questions about your income, savings, and debt, and get a clear
            next priority based on published guidance from the CFPB, Fidelity, and Vanguard.
          </p>
        </div>
        <button type="button" onClick={() => setIsStarted(true)}>
          Start Your Financial Health Check
        </button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="result-card">
        <div className="result-header">
          <h2>Financial Health Check</h2>
          <p className="result-subtitle">
            Current stage: <strong>{result.stageLabel}</strong>
          </p>
        </div>

        <p className="note-callout">{result.recommendedFocus}</p>

        <div className="summary-grid">
          <div className="summary-tile">
            <span className="summary-label">
              Emergency Fund
              <InfoTip text="A common guideline is 3-6 months of essential expenses, starting with a $1,000 milestone." />
            </span>
            <strong className={STATUS_CLASS[result.emergencyFund.status]}>
              {formatDollars(result.emergencyFund.current)} ({result.emergencyFund.monthsCovered} mo)
            </strong>
            <span className="helper-text">
              Target: {formatDollars(result.emergencyFund.targetLow)}–{formatDollars(result.emergencyFund.targetHigh)}
            </span>
          </div>

          <div className="summary-tile">
            <span className="summary-label">
              High-Interest Debt
              <InfoTip text="Debt above roughly 7% APR usually costs more than typical long-term market returns, so paying it off takes priority over investing more." />
            </span>
            <strong className={result.debt.hasHighInterestDebt ? "gauge-critical" : "gauge-good"}>
              {result.debt.hasHighInterestDebt
                ? `${formatDollars(result.debt.balance)} at ${result.debt.apr}% APR`
                : "None"}
            </strong>
          </div>

          <div className="summary-tile">
            <span className="summary-label">
              Savings Rate
              <InfoTip text="Fidelity's guideline: about 15% of income toward retirement plus 5% toward short-term savings, roughly 20% combined." />
            </span>
            <strong className={STATUS_CLASS[result.savingsRate.status]}>
              {result.savingsRate.ratePercent}%
            </strong>
            <span className="helper-text">Benchmark: {result.savingsRate.benchmarkPercent}%</span>
          </div>

          <div className="summary-tile">
            <span className="summary-label">
              Investment Rate
              <InfoTip text="A common guideline is investing around 15% of income toward retirement." />
            </span>
            <strong className={STATUS_CLASS[result.investmentRate.status]}>
              {result.investmentRate.ratePercent}%
            </strong>
            <span className="helper-text">Benchmark: {result.investmentRate.benchmarkPercent}%</span>
          </div>
        </div>

        {result.notes.length > 0 && (
          <div className="recommendation-notes">
            {result.notes.map((note, index) => (
              <p key={index} className="note-callout">
                {note}
              </p>
            ))}
          </div>
        )}

        <p className="helper-text">{result.disclaimer}</p>

        <button type="button" onClick={startOver}>
          Retake Check-up
        </button>
      </div>
    );
  }

  return (
    <div className="result-card">
      <div className="result-header">
        <h2>Financial Health Check</h2>
        <p className="helper-text">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>

      <div className="questionnaire-step">
        <p className="questionnaire-question">{currentStep.question}</p>
        {currentStep.helper && <p className="helper-text">{currentStep.helper}</p>}

        {currentStep.key === "monthlyIncome" && (
          <input
            type="number"
            placeholder="e.g. 4000"
            value={answers.monthlyIncome === 0 ? "" : answers.monthlyIncome}
            onChange={(e) => setAnswers({ ...answers, monthlyIncome: Number(e.target.value) })}
          />
        )}

        {currentStep.key === "monthlyEssentialExpenses" && (
          <input
            type="number"
            placeholder="e.g. 2000"
            value={answers.monthlyEssentialExpenses === 0 ? "" : answers.monthlyEssentialExpenses}
            onChange={(e) =>
              setAnswers({ ...answers, monthlyEssentialExpenses: Number(e.target.value) })
            }
          />
        )}

        {currentStep.key === "emergencyFundBalance" && (
          <input
            type="number"
            placeholder="e.g. 1000"
            value={answers.emergencyFundBalance === 0 ? "" : answers.emergencyFundBalance}
            onChange={(e) =>
              setAnswers({ ...answers, emergencyFundBalance: Number(e.target.value) })
            }
          />
        )}

        {currentStep.key === "hasHighInterestDebt" && (
          <>
            <div className="choice-row">
              <button
                type="button"
                className={answers.hasHighInterestDebt === true ? "choice-selected" : ""}
                onClick={() => setAnswers({ ...answers, hasHighInterestDebt: true })}
              >
                Yes
              </button>
              <button
                type="button"
                className={answers.hasHighInterestDebt === false ? "choice-selected" : ""}
                onClick={() =>
                  setAnswers({
                    ...answers,
                    hasHighInterestDebt: false,
                    highInterestDebtBalance: 0,
                    highInterestDebtApr: 0,
                  })
                }
              >
                No
              </button>
            </div>

            {answers.hasHighInterestDebt === true && (
              <div className="input-row">
                <div className="field-group">
                  <label className="field-label">Total Balance</label>
                  <input
                    type="number"
                    placeholder="e.g. 3000"
                    value={answers.highInterestDebtBalance === 0 ? "" : answers.highInterestDebtBalance}
                    onChange={(e) =>
                      setAnswers({ ...answers, highInterestDebtBalance: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Approximate APR (%)</label>
                  <input
                    type="number"
                    placeholder="e.g. 22"
                    value={answers.highInterestDebtApr === 0 ? "" : answers.highInterestDebtApr}
                    onChange={(e) =>
                      setAnswers({ ...answers, highInterestDebtApr: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}

        {currentStep.key === "monthlySavingsSplit" && (
          <div className="input-row">
            <div className="field-group">
              <label className="field-label">To Emergency Savings</label>
              <input
                type="number"
                placeholder="e.g. 200"
                value={
                  answers.monthlySavingsToEmergencyFund === 0
                    ? ""
                    : answers.monthlySavingsToEmergencyFund
                }
                onChange={(e) =>
                  setAnswers({ ...answers, monthlySavingsToEmergencyFund: Number(e.target.value) })
                }
              />
            </div>
            <div className="field-group">
              <label className="field-label">To Investing</label>
              <input
                type="number"
                placeholder="e.g. 300"
                value={answers.monthlySavingsToInvesting === 0 ? "" : answers.monthlySavingsToInvesting}
                onChange={(e) =>
                  setAnswers({ ...answers, monthlySavingsToInvesting: Number(e.target.value) })
                }
              />
            </div>
          </div>
        )}

        {currentStep.key === "employerMatchStatus" && (
          <div className="choice-row choice-column">
            {(["none", "full", "partial"] as EmployerMatchStatus[]).map((option) => (
              <button
                key={option}
                type="button"
                className={answers.employerMatchStatus === option ? "choice-selected" : ""}
                onClick={() => setAnswers({ ...answers, employerMatchStatus: option })}
              >
                {option === "none"
                  ? "No employer match available"
                  : option === "full"
                  ? "Yes, and I'm getting the full match"
                  : "Yes, but I'm not getting the full match"}
              </button>
            ))}
          </div>
        )}
      </div>

      {errorMessage && <p className="error-text">{errorMessage}</p>}

      <div className="questionnaire-nav">
        <button type="button" onClick={goBack} disabled={step === 0 || isSubmitting}>
          Back
        </button>
        <button type="button" onClick={goNext} disabled={!isStepAnswered() || isSubmitting}>
          {isSubmitting ? "Evaluating..." : isLastStep ? "See My Results" : "Next"}
        </button>
      </div>
    </div>
  );
}
