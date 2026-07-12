import { useEffect, useState } from "react";
import { authHeaders, onAuthChange } from "../auth";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type Horizon = "short" | "medium" | "long";
type RiskReaction = "sell" | "hold" | "buy_more";
type IncomeNeed = "none" | "some" | "primary";
type Experience = "new" | "some" | "experienced";

type Answers = {
  initialAmount: number;
  monthlyIncome: number;
  monthlySavings: number;
  hasEmergencyFund: boolean | null;
  hasHighInterestDebt: boolean | null;
  horizon: Horizon | null;
  riskReaction: RiskReaction | null;
  incomeNeed: IncomeNeed | null;
  experience: Experience | null;
};

const INITIAL_ANSWERS: Answers = {
  initialAmount: 0,
  monthlyIncome: 0,
  monthlySavings: 0,
  hasEmergencyFund: null,
  hasHighInterestDebt: null,
  horizon: null,
  riskReaction: null,
  incomeNeed: null,
  experience: null,
};

type RecommendationItem = {
  symbol: string;
  name: string;
  category: string;
  sector: string | null;
  riskBucket: "low" | "medium" | "high";
  price: number | null;
  currency: string;
  dividendYield: number | null;
  trailingPE: number | null;
  beta: number | null;
  reason: string;
};

type RecommendationResult = {
  riskProfile: "conservative" | "moderate" | "aggressive";
  profileSummary: string;
  targetAllocation: { stocks: number; bonds: number; cash: number };
  notes: string[];
  coreHoldings: RecommendationItem[];
  recommendations: RecommendationItem[];
  isPremiumUser: boolean;
  totalPicksAvailable: number;
  disclaimer: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  growth: "Growth",
  value: "Value",
  dividend: "Dividend",
  defensive: "Defensive",
  core: "Core Holding",
  broad_etf: "Broad Market ETF",
  intl_etf: "International ETF",
  bond_etf: "Bond ETF",
  dividend_etf: "Dividend ETF",
};

// Text-only coloring (headings, inline labels) -- shares the analyst gauge's status classes.
const RISK_BUCKET_TEXT_CLASS: Record<string, string> = {
  low: "gauge-good",
  medium: "gauge-warning",
  high: "gauge-critical",
};

// Full badge coloring (background + border) -- shares the news sentiment badge classes,
// since "low risk" / "positive" and "high risk" / "negative" use the same color semantics.
const RISK_BUCKET_BADGE_CLASS: Record<string, string> = {
  low: "sentiment-positive",
  medium: "sentiment-neutral",
  high: "sentiment-negative",
};

function formatMoney(value: number | null, currency: string) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return `${currency ? currency + " " : ""}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type Step = {
  key: keyof Answers;
  question: string;
  helper?: string;
};

const STEPS: Step[] = [
  { key: "initialAmount", question: "How much do you have available to invest right now?" },
  {
    key: "monthlyIncome",
    question: "What is your monthly take-home income?",
    helper: "Only used to sanity-check your plan -- e.g. to warn if you'd be investing more than you can comfortably afford.",
  },
  { key: "monthlySavings", question: "How much can you invest each month going forward?" },
  {
    key: "hasEmergencyFund",
    question: "Do you have 3-6 months of expenses saved in an emergency fund?",
    helper: "This is money set aside in cash for unexpected costs, separate from investments.",
  },
  {
    key: "hasHighInterestDebt",
    question: "Do you have any high-interest debt, like credit cards or personal loans?",
  },
  {
    key: "horizon",
    question: "When do you expect to need this money?",
    helper: "This affects how much short-term ups and downs you can ride out.",
  },
  {
    key: "riskReaction",
    question: "If your investments dropped 20% in a month, what would you most likely do?",
    helper: "There's no wrong answer -- this helps gauge your real comfort with risk.",
  },
  {
    key: "incomeNeed",
    question: "Do you need your investments to pay you cash along the way?",
    helper:
      "If you won't spend from this account for years, payouts (dividends) are usually less efficient than letting everything grow -- they're taxed as they arrive.",
  },
  {
    key: "experience",
    question: "How much investing experience do you have?",
    helper: "This adjusts how many individual stocks vs diversified funds we suggest.",
  },
];

export default function StockRecommendations() {
  const [step, setStep] = useState<number>(0);
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [result, setResult] = useState<RecommendationResult | null>(null);

  // Refetch when login/logout/upgrade/downgrade changes -- premium fields
  // (pick count, etc.) depend on it, but only matters once results exist.
  useEffect(() => {
    return onAuthChange(() => {
      if (result) {
        void submit();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const currentStep = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  function isStepAnswered(): boolean {
    const value = answers[currentStep.key];

    if (currentStep.key === "initialAmount" || currentStep.key === "monthlySavings") {
      return true; // 0 is a valid answer (e.g. no lump sum to start with)
    }

    if (currentStep.key === "monthlyIncome") {
      return value !== null && (value as number) >= 0;
    }

    return value !== null && value !== undefined;
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
  }

  async function submit() {
    try {
      setIsSubmitting(true);
      setErrorMessage("");

      const response = await fetch(`${API_BASE_URL}/stocks/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          initialAmount: answers.initialAmount,
          monthlyIncome: answers.monthlyIncome,
          monthlySavings: answers.monthlySavings,
          hasEmergencyFund: answers.hasEmergencyFund,
          hasHighInterestDebt: answers.hasHighInterestDebt,
          horizon: answers.horizon,
          riskReaction: answers.riskReaction,
          incomeNeed: answers.incomeNeed,
          experience: answers.experience,
        }),
      });

      const data = await response.json();

      if (data.error) {
        setErrorMessage("Could not generate recommendations. Please try again.");
        return;
      }

      setResult(data);
    } catch (error) {
      console.error(error);
      setErrorMessage("Cannot connect to backend.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (result) {
    const allocation = result.targetAllocation;

    return (
      <div className="result-card recommendations-result">
        <div className="result-header">
          <h2>Your Recommendations</h2>
          <p className="result-subtitle">
            Risk profile:{" "}
            <strong className={RISK_BUCKET_TEXT_CLASS[
              result.riskProfile === "conservative"
                ? "low"
                : result.riskProfile === "moderate"
                ? "medium"
                : "high"
            ]}>
              {result.riskProfile.charAt(0).toUpperCase() + result.riskProfile.slice(1)}
            </strong>
          </p>
        </div>

        {result.profileSummary && (
          <p className="note-callout">{result.profileSummary}</p>
        )}

        <div>
          <h3>Suggested Starting Allocation</h3>
          <div className="allocation-bar">
            <div
              className="allocation-segment allocation-stocks"
              style={{ width: `${allocation.stocks}%` }}
            />
            <div
              className="allocation-segment allocation-bonds"
              style={{ width: `${allocation.bonds}%` }}
            />
            <div
              className="allocation-segment allocation-cash"
              style={{ width: `${allocation.cash}%` }}
            />
          </div>
          <div className="allocation-legend">
            <span><i className="allocation-swatch allocation-stocks" />Stocks {allocation.stocks}%</span>
            <span><i className="allocation-swatch allocation-bonds" />Bonds {allocation.bonds}%</span>
            <span><i className="allocation-swatch allocation-cash" />Cash {allocation.cash}%</span>
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

        {result.coreHoldings.length > 0 && (
          <div>
            <h3>Core Holdings</h3>
            <div className="recommendation-cards">
              {result.coreHoldings.map((item) => (
                <RecommendationCard key={item.symbol} item={item} />
              ))}
            </div>
          </div>
        )}

        <div>
          <h3>Suggested Picks</h3>
          <div className="recommendation-cards">
            {result.recommendations.map((item) => (
              <RecommendationCard key={item.symbol} item={item} />
            ))}
          </div>

          {!result.isPremiumUser &&
            result.totalPicksAvailable > result.recommendations.length && (
              <div className="locked-feature locked-feature-inline">
                <p>
                  {result.totalPicksAvailable - result.recommendations.length} more
                  picks tailored to your profile are available with Pro.
                </p>
                <span className="tier-badge tier-badge-pro">Pro</span>
              </div>
            )}
        </div>

        <p className="helper-text">{result.disclaimer}</p>

        <button type="button" onClick={startOver}>
          Start Over
        </button>
      </div>
    );
  }

  return (
    <div className="result-card recommendations-questionnaire">
      <div className="result-header">
        <h2>Stock Recommendations</h2>
        <p className="result-subtitle">
          Answer a few questions and get educational stock suggestions based on your
          situation and comfort with risk.
        </p>
      </div>

      <p className="helper-text">
        Step {step + 1} of {STEPS.length}
      </p>

      <div className="questionnaire-step">
        <p className="questionnaire-question">{currentStep.question}</p>
        {currentStep.helper && <p className="helper-text">{currentStep.helper}</p>}

        {currentStep.key === "initialAmount" && (
          <input
            type="number"
            placeholder="e.g. 1000"
            value={answers.initialAmount === 0 ? "" : answers.initialAmount}
            onChange={(e) =>
              setAnswers({ ...answers, initialAmount: Number(e.target.value) })
            }
          />
        )}

        {currentStep.key === "monthlyIncome" && (
          <input
            type="number"
            placeholder="e.g. 4000"
            value={answers.monthlyIncome === 0 ? "" : answers.monthlyIncome}
            onChange={(e) =>
              setAnswers({ ...answers, monthlyIncome: Number(e.target.value) })
            }
          />
        )}

        {currentStep.key === "monthlySavings" && (
          <input
            type="number"
            placeholder="e.g. 300"
            value={answers.monthlySavings === 0 ? "" : answers.monthlySavings}
            onChange={(e) =>
              setAnswers({ ...answers, monthlySavings: Number(e.target.value) })
            }
          />
        )}

        {currentStep.key === "hasEmergencyFund" && (
          <div className="choice-row">
            <button
              type="button"
              className={answers.hasEmergencyFund === true ? "choice-selected" : ""}
              onClick={() => setAnswers({ ...answers, hasEmergencyFund: true })}
            >
              Yes
            </button>
            <button
              type="button"
              className={answers.hasEmergencyFund === false ? "choice-selected" : ""}
              onClick={() => setAnswers({ ...answers, hasEmergencyFund: false })}
            >
              No
            </button>
          </div>
        )}

        {currentStep.key === "hasHighInterestDebt" && (
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
              onClick={() => setAnswers({ ...answers, hasHighInterestDebt: false })}
            >
              No
            </button>
          </div>
        )}

        {currentStep.key === "horizon" && (
          <div className="choice-row">
            {(["short", "medium", "long"] as Horizon[]).map((option) => (
              <button
                key={option}
                type="button"
                className={answers.horizon === option ? "choice-selected" : ""}
                onClick={() => setAnswers({ ...answers, horizon: option })}
              >
                {option === "short"
                  ? "Under 3 years"
                  : option === "medium"
                  ? "3-10 years"
                  : "10+ years"}
              </button>
            ))}
          </div>
        )}

        {currentStep.key === "riskReaction" && (
          <div className="choice-row choice-column">
            {(["sell", "hold", "buy_more"] as RiskReaction[]).map((option) => (
              <button
                key={option}
                type="button"
                className={answers.riskReaction === option ? "choice-selected" : ""}
                onClick={() => setAnswers({ ...answers, riskReaction: option })}
              >
                {option === "sell"
                  ? "Sell some to limit further losses"
                  : option === "hold"
                  ? "Hold and wait it out"
                  : "Buy more while prices are lower"}
              </button>
            ))}
          </div>
        )}

        {currentStep.key === "incomeNeed" && (
          <div className="choice-row choice-column">
            {(["none", "some", "primary"] as IncomeNeed[]).map((option) => (
              <button
                key={option}
                type="button"
                className={answers.incomeNeed === option ? "choice-selected" : ""}
                onClick={() => setAnswers({ ...answers, incomeNeed: option })}
              >
                {option === "none"
                  ? "No — reinvest everything and let it grow"
                  : option === "some"
                  ? "Some payouts would be nice, but growth matters more"
                  : "Yes — I'm counting on regular payouts"}
              </button>
            ))}
          </div>
        )}

        {currentStep.key === "experience" && (
          <div className="choice-row choice-column">
            {(["new", "some", "experienced"] as Experience[]).map((option) => (
              <button
                key={option}
                type="button"
                className={answers.experience === option ? "choice-selected" : ""}
                onClick={() => setAnswers({ ...answers, experience: option })}
              >
                {option === "new"
                  ? "New to investing"
                  : option === "some"
                  ? "Some experience"
                  : "Experienced"}
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
          {isSubmitting ? "Generating..." : isLastStep ? "Get My Recommendations" : "Next"}
        </button>
      </div>
    </div>
  );
}

function RecommendationCard({ item }: { item: RecommendationItem }) {
  return (
    <div className="recommendation-card">
      <div className="recommendation-card-header">
        <div>
          <strong>{item.symbol}</strong>
          <p className="helper-text">{item.name}</p>
        </div>
        <span className={`sentiment-badge ${RISK_BUCKET_BADGE_CLASS[item.riskBucket]}`}>
          {item.riskBucket} risk
        </span>
      </div>

      <p className="recommendation-card-price">
        {formatMoney(item.price, item.currency)}
      </p>

      <p className="helper-text">
        {CATEGORY_LABELS[item.category] ?? item.category}
        {item.sector ? ` · ${item.sector}` : ""}
      </p>

      <p className="recommendation-card-reason">{item.reason}</p>
    </div>
  );
}
