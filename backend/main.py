from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
from pydantic import BaseModel, Field
from typing import Literal
from datetime import date, datetime, timedelta
import calendar
import pandas as pd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://menoliku.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class BacktestRequest(BaseModel):
    symbol: str
    startDate: str
    principal: float = Field(ge=0)
    recurringAmount: float = Field(ge=0)
    recurringFrequency: Literal["weekly", "monthly"]

def add_one_month(input_date: date):
    if input_date.month == 12:
        new_year = input_date.year + 1
        new_month = 1
    else:
        new_year = input_date.year
        new_month = input_date.month + 1

    last_day = calendar.monthrange(new_year, new_month)[1]
    new_day = min(input_date.day, last_day)

    return input_date.replace(year=new_year, month=new_month, day=new_day)


def add_period(input_date: date, frequency: str):
    if frequency == "weekly":
        return input_date + timedelta(weeks=1)

    return add_one_month(input_date)


@app.post("/stocks/backtest")
def backtest_stock(request: BacktestRequest):
    try:
        symbol = request.symbol.strip().upper()

        if symbol == "":
            return {"error": "No stock symbol provided"}

        start_date = datetime.strptime(request.startDate, "%Y-%m-%d").date()
        today = date.today()

        if start_date > today:
            return {"error": "Start date cannot be in the future"}

        ticker = yf.Ticker(symbol)

        history = ticker.history(
            start=start_date.isoformat(),
            end=(today + timedelta(days=1)).isoformat(),
            auto_adjust=True
        )

        if history.empty:
            return {"error": "No historical price data found"}

        prices = history["Close"].dropna()
        prices.index = pd.to_datetime(prices.index).tz_localize(None).normalize()

        if prices.empty:
            return {"error": "No closing price data found"}

        try:
            currency = ticker.info.get("currency", "")
        except Exception:
            currency = ""

        def get_price_on_or_after(target_date: date):
            target_timestamp = pd.Timestamp(target_date)
            available_prices = prices[prices.index >= target_timestamp]

            if available_prices.empty:
                return None, None

            buy_date = available_prices.index[0]
            buy_price = float(available_prices.iloc[0])

            return buy_date.date().isoformat(), buy_price

        total_shares = 0
        total_invested = 0
        transactions = []

        # Initial principal investment
        first_buy_date, first_buy_price = get_price_on_or_after(start_date)

        if first_buy_price is None:
            return {"error": "Could not find a valid first buy price"}

        if request.principal > 0:
            shares_bought = request.principal / first_buy_price
            total_shares += shares_bought
            total_invested += request.principal

            transactions.append({
                "date": first_buy_date,
                "amount": round(request.principal, 2),
                "price": round(first_buy_price, 4),
                "shares": round(shares_bought, 6),
                "type": "initial"
            })

        # Recurring investments start from the next period
        recurring_date = add_period(start_date, request.recurringFrequency)

        while recurring_date <= today:
            buy_date, buy_price = get_price_on_or_after(recurring_date)

            if buy_price is not None and request.recurringAmount > 0:
                shares_bought = request.recurringAmount / buy_price
                total_shares += shares_bought
                total_invested += request.recurringAmount

                transactions.append({
                    "date": buy_date,
                    "amount": round(request.recurringAmount, 2),
                    "price": round(buy_price, 4),
                    "shares": round(shares_bought, 6),
                    "type": request.recurringFrequency
                })

            recurring_date = add_period(recurring_date, request.recurringFrequency)

        latest_price = float(prices.iloc[-1])
        latest_date = prices.index[-1].date().isoformat()

        current_value = total_shares * latest_price
        gain_loss = current_value - total_invested

        if total_invested > 0:
            gain_loss_percent = (gain_loss / total_invested) * 100
        else:
            gain_loss_percent = 0

        return {
            "symbol": symbol,
            "currency": currency,
            "startDate": start_date.isoformat(),
            "latestDate": latest_date,
            "latestPrice": round(latest_price, 4),
            "totalInvested": round(total_invested, 2),
            "totalShares": round(total_shares, 6),
            "currentValue": round(current_value, 2),
            "gainLoss": round(gain_loss, 2),
            "gainLossPercent": round(gain_loss_percent, 2),
            "totalTransactions": len(transactions),
            "transactions": transactions[-5:]
        }

    except ValueError:
        return {"error": "Invalid date format. Use YYYY-MM-DD"}

    except Exception as e:
        return {
            "error": str(e),
            "message": "Failed to calculate backtest"
        }

@app.get("/stocks/search")
def search_stocks(q: str = Query("")):
    q = q.strip()

    if q == "":
        return []

    try:
        search_result = yf.Search(q, max_results=10).quotes

        stocks = []

        for item in search_result:
            symbol = item.get("symbol")
            name = (
                item.get("shortname")
                or item.get("longname")
                or item.get("name")
                or ""
            )

            exchange = item.get("exchange", "")
            quote_type = item.get("quoteType", "")

            if symbol:
                stocks.append({
                    "symbol": symbol,
                    "name": name,
                    "exchange": exchange,
                    "quoteType": quote_type
                })

        return stocks

    except Exception as e:
        return {
            "error": str(e),
            "message": "Failed to fetch from Yahoo Finance"
        }
    
@app.get("/stocks/price")
def get_stock_price(symbol: str = Query("")):
    symbol = symbol.strip().upper()

    if symbol == "":
        return {"error": "No symbol provided"}

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        current_price = (
            info.get("currentPrice")
            or info.get("regularMarketPrice")
            or info.get("previousClose")
        )

        currency = info.get("currency", "")
        company_name = info.get("shortName") or info.get("longName") or symbol
        previous_close = info.get("previousClose")
        market_cap = info.get("marketCap")

        return {
            "symbol": symbol,
            "name": company_name,
            "price": current_price,
            "currency": currency,
            "previousClose": previous_close,
            "marketCap": market_cap,
        }

    except Exception as e:
        return {
            "error": str(e),
            "message": "Failed to fetch stock price"
        }
    
    