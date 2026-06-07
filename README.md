# Finance Backtester

A full-stack finance backtesting web application that allows users to search for stocks, view live price information, and simulate historical investment performance using Yahoo Finance data.

The application lets users select a stock, choose an investment start date, enter an initial principal amount, add recurring weekly or monthly investments, and calculate the estimated portfolio value from the selected date until today.

## Live Demo

Frontend: `https://your-github-username.github.io/Finance-Calculator/`
Backend API: `https://your-render-backend-url.onrender.com`

## Features

* Search for stocks by company name or ticker symbol
* Fetch stock data from Yahoo Finance through a FastAPI backend
* Display selected stock information and latest price data
* Select investment start date
* Enter initial principal investment amount
* Enter recurring investment amount
* Choose recurring investment frequency: weekly or monthly
* Calculate:

  * Total amount invested
  * Total shares accumulated
  * Latest stock price
  * Current estimated portfolio value
  * Gain or loss amount
  * Gain or loss percentage
  * Recent simulated buy transactions

## Tech Stack

### Frontend

* React
* TypeScript
* Vite
* CSS
* GitHub Pages

### Backend

* Python
* FastAPI
* Uvicorn
* yfinance
* pandas
* Render

## Project Structure

```txt
Finance-Calculator/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── .venv/
├── src/
│   ├── App.tsx
│   ├── App.css
│   └── main.tsx
├── public/
├── .env.local
├── .env.production
├── package.json
├── vite.config.ts
└── README.md
```

## How It Works

The application uses a React frontend and a Python FastAPI backend.

```txt
React Frontend
      ↓
FastAPI Backend
      ↓
Yahoo Finance Data
      ↓
Backtest Calculation
      ↓
Results Displayed in React
```

The frontend sends stock search and backtest requests to the backend. The backend retrieves stock data using `yfinance`, processes historical price data, performs the investment simulation, and returns the calculated results to the frontend.

## Backend API Endpoints

### Health Check

```http
GET /
```

Returns a simple message confirming that the API is running.

### Search Stocks

```http
GET /stocks/search?q=apple
```

Searches for stock symbols and company names based on the user query.

Example response:

```json
[
  {
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "exchange": "NMS",
    "quoteType": "EQUITY"
  }
]
```

### Get Stock Price

```http
GET /stocks/price?symbol=AAPL
```

Returns price information for the selected stock.

Example response:

```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "price": 195.64,
  "currency": "USD",
  "previousClose": 193.42,
  "marketCap": 2950000000000
}
```

### Run Backtest

```http
POST /stocks/backtest
```

Example request body:

```json
{
  "symbol": "AAPL",
  "startDate": "2020-01-01",
  "principal": 1000,
  "recurringAmount": 100,
  "recurringFrequency": "monthly"
}
```

Example response:

```json
{
  "symbol": "AAPL",
  "currency": "USD",
  "startDate": "2020-01-01",
  "latestDate": "2026-06-01",
  "latestPrice": 195.64,
  "totalInvested": 8700,
  "totalShares": 85.234521,
  "currentValue": 16676.47,
  "gainLoss": 7976.47,
  "gainLossPercent": 91.68,
  "totalTransactions": 78
}
```

## Local Development

### Prerequisites

Make sure you have the following installed:

* Node.js
* Python 3.10 or above
* Git

## Frontend Setup

Install frontend dependencies:

```bash
npm install
```

Create a local environment file:

```txt
.env.local
```

Add your backend API URL:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

If you want to use the deployed Render backend locally, use:

```env
VITE_API_BASE_URL=https://your-render-backend-url.onrender.com
```

Start the frontend development server:

```bash
npm run dev
```

The frontend will run at:

```txt
http://localhost:5173
```

## Backend Setup

Go into the backend folder:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv .venv
```

Activate the virtual environment.

For Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

For Windows Command Prompt:

```cmd
.venv\Scripts\activate
```

Install backend dependencies:

```bash
pip install -r requirements.txt
```

Start the FastAPI backend:

```bash
python -m uvicorn main:app --reload
```

The backend will run at:

```txt
http://127.0.0.1:8000
```

You can test the backend by visiting:

```txt
http://127.0.0.1:8000/stocks/search?q=apple
```

## Production Deployment

### Frontend Deployment

The frontend is deployed using GitHub Pages.

For Vite projects deployed under a GitHub repository path, make sure `vite.config.ts` includes the correct base path:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/Finance-Calculator/",
});
```

Create a production environment file:

```txt
.env.production
```

Add the deployed backend URL:

```env
VITE_API_BASE_URL=https://your-render-backend-url.onrender.com
```

Build the frontend:

```bash
npm run build
```

Deploy using GitHub Pages or GitHub Actions.

### Backend Deployment

The backend is deployed on Render as a Python Web Service.

Render settings:

| Setting        | Value                                          |
| -------------- | ---------------------------------------------- |
| Root Directory | `backend`                                      |
| Build Command  | `pip install -r requirements.txt`              |
| Start Command  | `uvicorn main:app --host 0.0.0.0 --port $PORT` |

Make sure the backend CORS settings allow the deployed GitHub Pages frontend:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://your-github-username.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Example Use Case

A user wants to know how much their investment would be worth today if they had invested in Apple from 2020.

Example inputs:

```txt
Stock: AAPL
Start Date: 2020-01-01
Principal Amount: 1000
Recurring Investment: 100
Frequency: Monthly
```

The app simulates buying shares using historical closing prices from Yahoo Finance and calculates the estimated value of the investment today.

## Important Notes

This project is for educational and portfolio purposes only.

The calculation uses historical closing prices from Yahoo Finance data. It does not account for:

* Brokerage fees
* Taxes
* Currency conversion fees
* Dividend reinvestment
* Stock splits beyond adjusted historical pricing
* Slippage
* Exact intraday execution prices

The results should not be considered financial advice.

## Future Improvements

* Add charts for portfolio value over time
* Add dividend reinvestment support
* Add currency conversion
* Add comparison between multiple stocks
* Add ETF support
* Add user authentication and saved portfolios
* Add downloadable backtest reports
* Improve mobile responsiveness
* Add unit tests for backend calculation logic

## Author

Created by Marcus Lee.

This project was built as a full-stack portfolio project to demonstrate frontend development, backend API development, financial data handling, and deployment using GitHub Pages and Render.
