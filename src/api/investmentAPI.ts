export type InvestmentRequest = {
  ticker: string;
  principal: number;
  monthly_deposit: number;
  years: number;
};

export type InvestmentResponse = {
  ticker: string;
  principal: number;
  monthly_deposit: number;
  years: number;
  total_invested: number;
  estimated_value: number;
};

export async function calculateInvestment(
  data: InvestmentRequest
): Promise<InvestmentResponse> {
  const response = await fetch("http://localhost:8000/calculate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to calculate investment");
  }

  return response.json();
}