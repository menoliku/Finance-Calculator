// Pure financial math for the Tools calculators. No React, no fetch --
// every function here is deterministic so it can be unit tested directly
// once a frontend test runner is added.

export type YearPoint = {
  year: number;
  value: number;
  contributed: number;
};

export type CompoundResult = {
  series: YearPoint[];
  finalValue: number;
  totalContributed: number;
  interestEarned: number;
};

// Monthly compounding: contributions are added at the end of each month,
// which matches how most people actually invest (paycheck by paycheck).
export function compoundGrowthSeries(
  initial: number,
  monthlyContribution: number,
  annualReturnPct: number,
  years: number
): CompoundResult {
  const monthlyRate = annualReturnPct / 100 / 12;
  const series: YearPoint[] = [{ year: 0, value: initial, contributed: initial }];

  let value = initial;
  let contributed = initial;

  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) {
      value = value * (1 + monthlyRate) + monthlyContribution;
      contributed += monthlyContribution;
    }

    series.push({
      year,
      value: Math.round(value * 100) / 100,
      contributed: Math.round(contributed * 100) / 100,
    });
  }

  const finalValue = series[series.length - 1].value;

  return {
    series,
    finalValue,
    totalContributed: Math.round(contributed * 100) / 100,
    interestEarned: Math.round((finalValue - contributed) * 100) / 100,
  };
}

export type LoanResult = {
  monthlyPayment: number;
  totalPaid: number;
  totalInterest: number;
};

// Standard amortization formula. A 0% rate would divide by zero, so that
// case falls back to simply splitting the principal across the months.
export function loanTotals(
  principal: number,
  annualRatePct: number,
  termYears: number
): LoanResult {
  const months = termYears * 12;

  if (months <= 0 || principal <= 0) {
    return { monthlyPayment: 0, totalPaid: 0, totalInterest: 0 };
  }

  const monthlyRate = annualRatePct / 100 / 12;

  const monthlyPayment =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));

  const totalPaid = monthlyPayment * months;

  return {
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalInterest: Math.round((totalPaid - principal) * 100) / 100,
  };
}

export type FireResult = {
  fireNumber: number;
  yearsToFire: number | null;
  series: { year: number; value: number }[];
};

// The FIRE number is the portfolio size where a fixed withdrawal rate covers
// annual expenses (the "4% rule" uses 4%). yearsToFire is null when the
// projection never gets there within 100 years -- growing expenses can't
// outrun zero savings, and an infinite loop helps nobody.
const FIRE_MAX_YEARS = 100;

export function fireProjection(
  annualExpenses: number,
  withdrawalRatePct: number,
  currentSavings: number,
  monthlySavings: number,
  annualReturnPct: number
): FireResult {
  const fireNumber =
    withdrawalRatePct > 0 ? (annualExpenses / withdrawalRatePct) * 100 : Infinity;

  const monthlyRate = annualReturnPct / 100 / 12;
  const series: { year: number; value: number }[] = [
    { year: 0, value: Math.round(currentSavings * 100) / 100 },
  ];

  let value = currentSavings;
  let yearsToFire: number | null = value >= fireNumber ? 0 : null;

  for (let year = 1; year <= FIRE_MAX_YEARS && yearsToFire === null; year++) {
    for (let month = 0; month < 12; month++) {
      value = value * (1 + monthlyRate) + monthlySavings;
    }

    series.push({ year, value: Math.round(value * 100) / 100 });

    if (value >= fireNumber) {
      yearsToFire = year;
    }
  }

  return {
    fireNumber: Number.isFinite(fireNumber)
      ? Math.round(fireNumber * 100) / 100
      : Infinity,
    yearsToFire,
    series,
  };
}

export function formatDollars(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
