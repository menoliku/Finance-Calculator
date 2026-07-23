from fastapi import FastAPI, Query, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer

import yfinance as yf
from pydantic import BaseModel, Field
from typing import Literal
import calendar
import logging
import os
import re
import secrets
import numpy as np
import pandas as pd
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from sqlalchemy import create_engine, Column, Integer, String, Float, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import date, datetime, timedelta, timezone
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from dotenv import load_dotenv

# Loads backend/.env so local dev gets a stable JWT_SECRET_KEY -- without it,
# every backend restart mints a new random key and silently logs everyone out.
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finance_calculator")

app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def log_and_generic_error(exc: Exception, client_message: str, context: str):
    """Logs the real exception server-side (with a traceback) and returns a
    client-safe error body -- endpoints previously returned str(exc) directly
    to the browser, which can leak internal details (file paths, library
    internals, DB errors) to anyone hitting the API."""
    logger.exception("%s failed: %s", context, exc)
    return {"error": client_message, "message": client_message}

# VADER's base lexicon is tuned for social-media text and misses financial
# jargon ("beats estimates", "sued", "downgrade"), so it's extended with
# finance-specific terms here rather than swapped for a heavier NLP model.
FINANCE_SENTIMENT_LEXICON = {
    "beat": 2.0, "beats": 2.0, "beating": 2.0, "surge": 2.5, "surges": 2.5, "surged": 2.5,
    "surging": 2.5, "soar": 2.5, "soars": 2.5, "soared": 2.5, "soaring": 2.5,
    "rally": 2.0, "rallies": 2.0, "rallied": 2.0, "jump": 1.5, "jumps": 1.5, "jumped": 1.5,
    "gain": 1.5, "gains": 1.5, "gained": 1.5, "rise": 1.3, "rises": 1.3, "risen": 1.3, "rising": 1.3,
    "upgrade": 2.0, "upgrades": 2.0, "upgraded": 2.0, "outperform": 2.0, "outperforms": 2.0,
    "bullish": 2.0, "record": 1.5, "records": 1.5, "breakthrough": 2.0, "growth": 1.3,
    "profit": 1.3, "profits": 1.3, "profitable": 1.5, "robust": 1.5, "exceeds": 2.0, "exceeded": 2.0,
    "boost": 1.5, "boosts": 1.5, "boosted": 1.5, "expand": 1.0, "expands": 1.0, "expansion": 1.0,
    "tops": 1.5, "topped": 1.5, "blowout": 2.0,
    "miss": -2.0, "misses": -2.0, "missed": -2.0, "plunge": -2.5, "plunges": -2.5, "plunged": -2.5,
    "slump": -2.0, "slumps": -2.0, "slumped": -2.0, "tumble": -2.0, "tumbles": -2.0, "tumbled": -2.0,
    "crash": -2.5, "crashes": -2.5, "crashed": -2.5, "sued": -2.0, "lawsuit": -1.8, "lawsuits": -1.8,
    "fraud": -3.0, "scandal": -2.5, "bankruptcy": -3.0, "bankrupt": -3.0, "layoff": -2.0, "layoffs": -2.0,
    "downgrade": -2.0, "downgrades": -2.0, "downgraded": -2.0, "bearish": -2.0, "recall": -1.8,
    "recalls": -1.8, "recalled": -1.8, "struggle": -1.5, "struggles": -1.5, "struggling": -1.5,
    "warns": -1.3, "warned": -1.3, "warning": -1.3, "decline": -1.5, "declines": -1.5, "declined": -1.5,
    "shortage": -1.5, "shortages": -1.5, "halted": -1.5, "jitters": -1.5, "fears": -1.5,
    "probe": -1.8, "investigation": -1.5, "fined": -2.0, "backlash": -2.0, "underperform": -2.0,
}

sentiment_analyzer = SentimentIntensityAnalyzer()
sentiment_analyzer.lexicon.update(FINANCE_SENTIMENT_LEXICON)


def classify_headline_sentiment(text: str):
    if not text:
        return "neutral", 0.0

    compound = sentiment_analyzer.polarity_scores(text)["compound"]

    if compound >= 0.05:
        label = "positive"
    elif compound <= -0.05:
        label = "negative"
    else:
        label = "neutral"

    return label, round(compound, 3)

# Production sets DATABASE_URL to a Postgres URL (persistent storage);
# without it, local dev falls back to a SQLite file with zero setup.
# NOTE: SQLite on a host with an ephemeral filesystem (e.g. Render) is wiped
# on every deploy -- never run real users on the fallback.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./finance_app.db")

# Render/Heroku hand out "postgres://" URLs, but SQLAlchemy 2 only accepts
# the "postgresql://" scheme.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        # SQLite objects to cross-thread use by default; FastAPI handlers run
        # in a threadpool, so this must be relaxed (SQLite only).
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        DATABASE_URL,
        # Managed Postgres closes idle connections; pre-ping replaces dead
        # ones instead of surfacing "server closed the connection" errors.
        pool_pre_ping=True,
    )

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

SECRET_KEY = os.environ.get("JWT_SECRET_KEY")

if not SECRET_KEY:
    # Falls back to a random key so local dev still works with zero setup --
    # every restart invalidates existing sessions (everyone just logs in again),
    # which is a safe failure mode and a strong nudge to set the real env var
    # before deploying anywhere real users can reach.
    SECRET_KEY = secrets.token_hex(32)
    print(
        "WARNING: JWT_SECRET_KEY environment variable is not set. Using a "
        "random key for this process only -- all sessions will be invalidated "
        "on restart. Set JWT_SECRET_KEY before deploying to production."
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)

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

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    subscription_tier = Column(String, nullable=False, default="free")
    role = Column(String, nullable=False, default="user")


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    symbol = Column(String, nullable=False)
    added_at = Column(String, nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    date = Column(String, nullable=False)
    type = Column(String, nullable=False)
    category = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    note = Column(String, nullable=True)
    created_at = Column(String, nullable=False)


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    category = Column(String, nullable=False)
    monthly_limit = Column(Float, nullable=False)


class NetWorthItem(Base):
    __tablename__ = "net_worth_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    name = Column(String, nullable=False)
    value = Column(Float, nullable=False)
    item_type = Column(String, nullable=False)


class Goal(Base):
    __tablename__ = "goals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    name = Column(String, nullable=False)
    target_amount = Column(Float, nullable=False)
    current_amount = Column(Float, nullable=False, default=0.0)
    target_date = Column(String, nullable=True)
    created_at = Column(String, nullable=False)


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(String, nullable=False)


class PortfolioTransaction(Base):
    __tablename__ = "portfolio_transactions"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, index=True, nullable=False)
    symbol = Column(String, nullable=False)
    type = Column(String, nullable=False)
    shares = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    date = Column(String, nullable=False)
    created_at = Column(String, nullable=False)


Base.metadata.create_all(bind=engine)

# create_all() only creates missing tables, not missing columns -- add
# subscription_tier to any users table that predates this column.
_existing_columns = [col["name"] for col in inspect(engine).get_columns("users")]
if "subscription_tier" not in _existing_columns:
    with engine.connect() as _connection:
        _connection.execute(
            text("ALTER TABLE users ADD COLUMN subscription_tier VARCHAR DEFAULT 'free'")
        )
        _connection.commit()

# The tier model went from binary free/premium to free/plus/pro/ultimate.
# Old "premium" users get "pro", which includes everything premium unlocked.
with engine.connect() as _connection:
    _connection.execute(
        text("UPDATE users SET subscription_tier = 'pro' WHERE subscription_tier = 'premium'")
    )
    _connection.commit()

if "role" not in _existing_columns:
    with engine.connect() as _connection:
        _connection.execute(
            text("ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'user'")
        )
        _connection.commit()

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str

class BacktestRequest(BaseModel):
    symbol: str
    startDate: str
    principal: float = Field(ge=0)
    recurringAmount: float = Field(ge=0)
    recurringFrequency: Literal["daily", "weekly", "monthly", "yearly"]

def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()


def hash_password(password: str):
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict):
    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    to_encode.update({"exp": expire})

    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")

        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")

    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == int(user_id)).first()

    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return user


def require_developer(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "developer":
        raise HTTPException(status_code=403, detail="Developer access required")

    return current_user


def validate_password(password: str) -> str | None:
    """Returns a beginner-friendly error message, or None when acceptable.
    Deliberately modest rules -- length plus letter+digit -- because forcing
    symbols/uppercase mostly produces 'Password1!' variants, not security."""
    if password != password.strip():
        return "Password cannot start or end with spaces."

    if len(password) < 8:
        return "Password must be at least 8 characters long."

    # bcrypt silently truncates beyond 72 bytes -- reject rather than let a
    # user think their 100-character passphrase is fully checked.
    if len(password.encode("utf-8")) > 72:
        return "Password must be 72 characters or fewer."

    if not re.search(r"[A-Za-z]", password):
        return "Password must contain at least one letter."

    if not re.search(r"\d", password):
        return "Password must contain at least one number."

    return None


def get_optional_user(
    token: str = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db)
):
    if not token:
        return None

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")

        if user_id is None:
            return None

        return db.query(User).filter(User.id == int(user_id)).first()
    except JWTError:
        return None


# Ordered subscription tiers: each tier includes everything below it.
# Plus = "pay to organize", Pro = "pay to analyze", Ultimate = "pay for coaching".
TIER_ORDER = {"free": 0, "plus": 1, "pro": 2, "ultimate": 3}


def has_tier(user, minimum_tier: str) -> bool:
    if user is None:
        return False

    # Unknown/legacy tier strings are treated as free rather than crashing.
    user_level = TIER_ORDER.get(user.subscription_tier, 0)
    return user_level >= TIER_ORDER[minimum_tier]

@app.get("/")
@app.get("/")
def home():
    return {
        "message": "Finance Calculator API is running",
        "routes": [
            "/auth/register",
            "/auth/login",
            "/auth/me",
            "/auth/subscription",
            "/watchlist",
            "/stocks/search?q=apple",
            "/stocks/price?symbol=AAPL",
            "/stocks/backtest",
            "/stocks/analysis?symbol=AAPL",
            "/stocks/recommendations",
            "/money/transactions",
            "/money/summary",
            "/money/budgets",
            "/money/networth",
            "/money/goals",
            "/portfolios",
        ]
    }

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

def add_one_year(input_date: date):
    try:
        return input_date.replace(year=input_date.year + 1)
    except ValueError:
        # Handles leap year Feb 29
        return input_date.replace(year=input_date.year + 1, day=28)

def add_period(input_date: date, frequency: str):
    if frequency == "daily":
        return input_date + timedelta(days=1)

    if frequency == "weekly":
        return input_date + timedelta(weeks=1)

    if frequency == "monthly":
        return add_one_month(input_date)

    if frequency == "yearly":
        return add_one_year(input_date)

    return add_one_month(input_date)


@app.post("/auth/register")
@limiter.limit("5/minute")
def register_user(request: Request, payload: RegisterRequest, db: Session = Depends(get_db)):
    existing_email = db.query(User).filter(User.email == payload.email).first()

    if existing_email:
        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )

    existing_username = db.query(User).filter(
        User.username == payload.username
    ).first()

    if existing_username:
        raise HTTPException(
            status_code=400,
            detail="Username already taken"
        )

    password_error = validate_password(payload.password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)

    new_user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=hash_password(payload.password)
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "Account created successfully",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email
        }
    }


@app.post("/auth/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login_user(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    access_token = create_access_token(data={"sub": str(user.id)})

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "subscriptionTier": user.subscription_tier,
        "role": user.role,
        "billingEnabled": billing_enabled(),
    }


@app.get("/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return user_payload(current_user)


class SubscriptionRequest(BaseModel):
    tier: Literal["free", "plus", "pro", "ultimate"]


# Real billing isn't wired up yet. Until it is, paid tiers cannot be granted --
# the UI shows them as "coming soon" and this flag makes the API enforce it,
# so the paywall can't be bypassed with a direct request. Set BILLING_ENABLED=true
# once a real payment flow (Stripe/Play Billing) confirms purchases.
def billing_enabled() -> bool:
    return os.environ.get("BILLING_ENABLED", "").lower() == "true"


# Sets the tier without charging a card -- gated by billing_enabled() above.
# Swap this out for a real Stripe Checkout + webhook flow when ready to take payment.
@app.post("/auth/subscription")
def set_subscription(
    payload: SubscriptionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Developers may switch their own tier freely (for testing gated features);
    # everyone else needs real billing once it exists.
    if payload.tier != "free" and not billing_enabled() and current_user.role != "developer":
        raise HTTPException(
            status_code=403,
            detail="Paid plans are coming soon. All current features marked Free are available during the beta."
        )

    current_user.subscription_tier = payload.tier
    db.commit()
    db.refresh(current_user)

    return user_payload(current_user)


# ---------------------------------------------------------------------------
# Developer role: activated by a secret code, can grant tiers to any user
# ---------------------------------------------------------------------------

def is_valid_developer_code(code: str) -> bool:
    """True only when DEVELOPER_ACCESS_CODE is configured to a non-empty value
    and the submitted code matches it (constant-time compare). An unset or
    empty env var means developer access is off -- misconfiguration must
    never open the door."""
    configured = os.environ.get("DEVELOPER_ACCESS_CODE", "")

    if not configured or not code:
        return False

    return secrets.compare_digest(code, configured)


class DeveloperActivationRequest(BaseModel):
    code: str


@app.post("/auth/developer")
@limiter.limit("5/minute")  # brute-force guard on the access code
def activate_developer(
    request: Request,
    payload: DeveloperActivationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not os.environ.get("DEVELOPER_ACCESS_CODE"):
        raise HTTPException(status_code=403, detail="Developer access is not configured")

    if not is_valid_developer_code(payload.code):
        raise HTTPException(status_code=403, detail="Invalid developer code")

    current_user.role = "developer"
    db.commit()
    db.refresh(current_user)

    logger.info("Developer role activated for user id=%s (%s)", current_user.id, current_user.username)

    return user_payload(current_user)


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


@app.post("/auth/password")
@limiter.limit("5/minute")  # slows brute-forcing a session-holder's password
def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not pwd_context.verify(payload.currentPassword, current_user.hashed_password):
        raise HTTPException(status_code=403, detail="Current password is incorrect")

    password_error = validate_password(payload.newPassword)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)

    current_user.hashed_password = hash_password(payload.newPassword)
    db.commit()

    return {"message": "Password updated"}


@app.post("/admin/users/{user_id}/password-reset")
@limiter.limit("10/minute")
def admin_reset_password(
    request: Request,
    user_id: int,
    current_user: User = Depends(require_developer),
    db: Session = Depends(get_db)
):
    """Beta substitute for email-based password reset: the developer generates
    a temporary password and hands it to the user out-of-band. The plaintext
    is returned exactly once and never logged or stored."""
    target = db.query(User).filter(User.id == user_id).first()

    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    # token_urlsafe can occasionally produce a string without a digit or
    # letter; regenerate until it passes our own rules (practically 1 try).
    for _ in range(5):
        temp_password = secrets.token_urlsafe(9)
        if validate_password(temp_password) is None:
            break
    else:
        temp_password = f"{secrets.token_urlsafe(6)}a1"

    target.hashed_password = hash_password(temp_password)
    db.commit()

    logger.info(
        "Developer id=%s reset the password for user id=%s (%s)",
        current_user.id, target.id, target.username,
    )

    return {
        "id": target.id,
        "username": target.username,
        "tempPassword": temp_password,
    }


@app.get("/admin/users")
def admin_list_users(
    current_user: User = Depends(require_developer),
    db: Session = Depends(get_db)
):
    users = db.query(User).order_by(User.id).all()

    return {
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "subscriptionTier": u.subscription_tier,
                "role": u.role,
            }
            for u in users
        ]
    }


@app.post("/admin/users/{user_id}/tier")
def admin_set_user_tier(
    user_id: int,
    payload: SubscriptionRequest,
    current_user: User = Depends(require_developer),
    db: Session = Depends(get_db)
):
    # Deliberately NOT gated by billing_enabled(): a developer grant is the
    # legitimate way to comp beta testers into paid tiers before billing exists.
    target = db.query(User).filter(User.id == user_id).first()

    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    target.subscription_tier = payload.tier

    db.commit()

    logger.info(
        "Developer id=%s granted tier '%s' to user id=%s (%s)",
        current_user.id, payload.tier, target.id, target.username,
    )

    return {
        "id": target.id,
        "username": target.username,
        "subscriptionTier": target.subscription_tier,
        "role": target.role,
    }


@app.delete("/auth/me")
def delete_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db.query(WatchlistItem).filter(WatchlistItem.user_id == current_user.id).delete()
    db.query(Transaction).filter(Transaction.user_id == current_user.id).delete()
    db.query(Budget).filter(Budget.user_id == current_user.id).delete()
    db.query(NetWorthItem).filter(NetWorthItem.user_id == current_user.id).delete()
    db.query(Goal).filter(Goal.user_id == current_user.id).delete()

    portfolio_ids = [
        p.id for p in db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    ]
    if portfolio_ids:
        db.query(PortfolioTransaction).filter(
            PortfolioTransaction.portfolio_id.in_(portfolio_ids)
        ).delete(synchronize_session=False)
    db.query(Portfolio).filter(Portfolio.user_id == current_user.id).delete()

    db.delete(current_user)
    db.commit()

    return {"message": "Account and all associated data deleted"}


class WatchlistAddRequest(BaseModel):
    symbol: str


FREE_TIER_WATCHLIST_LIMIT = 3


@app.get("/watchlist")
def get_watchlist(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == current_user.id)
        .order_by(WatchlistItem.added_at)
        .all()
    )

    enriched = []

    for item in items:
        try:
            info = yf.Ticker(item.symbol).info
        except Exception:
            info = {}

        price = info.get("currentPrice") or info.get("regularMarketPrice")
        previous_close = info.get("previousClose")

        change_percent = None
        if price is not None and previous_close:
            change_percent = round((price - previous_close) / previous_close * 100, 2)

        enriched.append({
            "symbol": item.symbol,
            "name": info.get("shortName") or info.get("longName") or item.symbol,
            "price": price,
            "currency": info.get("currency", ""),
            "changePercent": change_percent,
            "addedAt": item.added_at,
        })

    return {
        "items": enriched,
        "isPremiumUser": has_tier(current_user, "plus"),
        "limit": None if has_tier(current_user, "plus") else FREE_TIER_WATCHLIST_LIMIT,
    }


@app.post("/watchlist")
@limiter.limit("20/minute")
def add_to_watchlist(
    request: Request,
    payload: WatchlistAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    symbol = payload.symbol.strip().upper()

    if symbol == "":
        raise HTTPException(status_code=400, detail="No symbol provided")

    existing = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == current_user.id)
        .all()
    )

    if any(item.symbol == symbol for item in existing):
        raise HTTPException(status_code=400, detail="Already in your watchlist")

    if not has_tier(current_user, "plus") and len(existing) >= FREE_TIER_WATCHLIST_LIMIT:
        raise HTTPException(
            status_code=403,
            detail=f"Free accounts can save up to {FREE_TIER_WATCHLIST_LIMIT} stocks. Upgrade to Plus for an unlimited watchlist."
        )

    try:
        info = yf.Ticker(symbol).info
        if not (info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")):
            raise HTTPException(status_code=400, detail="Could not find that stock symbol")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not find that stock symbol")

    new_item = WatchlistItem(
        user_id=current_user.id,
        symbol=symbol,
        added_at=datetime.now(timezone.utc).isoformat(),
    )

    db.add(new_item)
    db.commit()

    return {"message": "Added to watchlist", "symbol": symbol}


@app.delete("/watchlist/{symbol}")
def remove_from_watchlist(
    symbol: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    symbol = symbol.strip().upper()

    deleted = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == current_user.id, WatchlistItem.symbol == symbol)
        .delete()
    )

    db.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Symbol not found in your watchlist")

    return {"message": "Removed from watchlist", "symbol": symbol}


# ---------------------------------------------------------------------------
# Money: budgeting, transactions, net worth
# ---------------------------------------------------------------------------

EXPENSE_CATEGORIES = [
    "Housing", "Food", "Transportation", "Utilities", "Entertainment",
    "Savings", "Debt", "Shopping", "Health", "Other",
]
INCOME_CATEGORY = "Income"
MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")


def compute_money_summary(transactions: list[dict], budgets: dict[str, float]) -> dict:
    """Pure summary calculation over a month's transactions -- kept free of
    the DB/request layer so it can be unit tested directly, same as the
    date-math and sentiment helpers above."""
    total_income = sum(t["amount"] for t in transactions if t["type"] == "income")
    total_expenses = sum(t["amount"] for t in transactions if t["type"] == "expense")
    net_cash_flow = total_income - total_expenses
    savings_rate = round(net_cash_flow / total_income, 4) if total_income > 0 else 0.0

    spent_by_category: dict[str, float] = defaultdict(float)
    for t in transactions:
        if t["type"] == "expense":
            spent_by_category[t["category"]] += t["amount"]

    categories = [
        {
            "category": category,
            "spent": round(spent_by_category.get(category, 0.0), 2),
            "budget": budgets.get(category),
        }
        for category in EXPENSE_CATEGORIES
    ]

    return {
        "totalIncome": round(total_income, 2),
        "totalExpenses": round(total_expenses, 2),
        "netCashFlow": round(net_cash_flow, 2),
        "savingsRate": savings_rate,
        "categories": categories,
    }


def current_month_string() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def resolve_month(month: str | None) -> str:
    if month is None:
        return current_month_string()

    if not MONTH_PATTERN.match(month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")

    return month


class TransactionCreateRequest(BaseModel):
    date: str
    type: Literal["income", "expense"]
    category: str
    amount: float = Field(gt=0)
    note: str | None = None


class BudgetUpdateRequest(BaseModel):
    budgets: dict[str, float]


class NetWorthItemCreateRequest(BaseModel):
    name: str
    value: float = Field(ge=0)
    item_type: Literal["asset", "liability"]


def get_user_budgets(db: Session, user_id: int) -> dict[str, float]:
    rows = db.query(Budget).filter(Budget.user_id == user_id).all()
    return {row.category: row.monthly_limit for row in rows}


@app.get("/money/transactions")
def get_transactions(
    month: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    resolved_month = resolve_month(month)

    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id, Transaction.date.like(f"{resolved_month}%"))
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .all()
    )

    return {
        "month": resolved_month,
        "transactions": [
            {
                "id": t.id,
                "date": t.date,
                "type": t.type,
                "category": t.category,
                "amount": t.amount,
                "note": t.note,
            }
            for t in transactions
        ],
    }


@app.post("/money/transactions")
@limiter.limit("30/minute")
def create_transaction(
    request: Request,
    payload: TransactionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    expected_category = INCOME_CATEGORY if payload.type == "income" else payload.category

    if payload.type == "income":
        if payload.category != INCOME_CATEGORY:
            raise HTTPException(status_code=400, detail=f"Income category must be '{INCOME_CATEGORY}'")
    elif payload.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown expense category")

    new_transaction = Transaction(
        user_id=current_user.id,
        date=payload.date,
        type=payload.type,
        category=expected_category,
        amount=payload.amount,
        note=payload.note,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    db.add(new_transaction)
    db.commit()
    db.refresh(new_transaction)

    return {
        "id": new_transaction.id,
        "date": new_transaction.date,
        "type": new_transaction.type,
        "category": new_transaction.category,
        "amount": new_transaction.amount,
        "note": new_transaction.note,
    }


@app.delete("/money/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    deleted = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == current_user.id)
        .delete()
    )

    db.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")

    return {"message": "Transaction deleted"}


@app.get("/money/summary")
def get_money_summary(
    month: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    resolved_month = resolve_month(month)

    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id, Transaction.date.like(f"{resolved_month}%"))
        .all()
    )

    transaction_dicts = [{"type": t.type, "category": t.category, "amount": t.amount} for t in transactions]
    budgets = get_user_budgets(db, current_user.id)

    return {"month": resolved_month, **compute_money_summary(transaction_dicts, budgets)}


@app.get("/money/budgets")
def get_budgets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return {"budgets": get_user_budgets(db, current_user.id)}


@app.put("/money/budgets")
@limiter.limit("10/minute")
def update_budgets(
    request: Request,
    payload: BudgetUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    unknown_categories = set(payload.budgets.keys()) - set(EXPENSE_CATEGORIES)
    if unknown_categories:
        raise HTTPException(status_code=400, detail=f"Unknown categories: {', '.join(sorted(unknown_categories))}")

    for category, monthly_limit in payload.budgets.items():
        if monthly_limit < 0:
            raise HTTPException(status_code=400, detail="Budget limits cannot be negative")

        existing = (
            db.query(Budget)
            .filter(Budget.user_id == current_user.id, Budget.category == category)
            .first()
        )

        if existing:
            existing.monthly_limit = monthly_limit
        else:
            db.add(Budget(user_id=current_user.id, category=category, monthly_limit=monthly_limit))

    db.commit()

    return {"budgets": get_user_budgets(db, current_user.id)}


@app.get("/money/networth")
def get_net_worth(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    items = db.query(NetWorthItem).filter(NetWorthItem.user_id == current_user.id).all()

    assets_total = sum(item.value for item in items if item.item_type == "asset")
    liabilities_total = sum(item.value for item in items if item.item_type == "liability")

    return {
        "items": [
            {"id": item.id, "name": item.name, "value": item.value, "itemType": item.item_type}
            for item in items
        ],
        "assetsTotal": round(assets_total, 2),
        "liabilitiesTotal": round(liabilities_total, 2),
        "netWorth": round(assets_total - liabilities_total, 2),
    }


@app.post("/money/networth")
@limiter.limit("30/minute")
def add_net_worth_item(
    request: Request,
    payload: NetWorthItemCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    name = payload.name.strip()

    if name == "":
        raise HTTPException(status_code=400, detail="Name is required")

    new_item = NetWorthItem(
        user_id=current_user.id,
        name=name,
        value=payload.value,
        item_type=payload.item_type,
    )

    db.add(new_item)
    db.commit()
    db.refresh(new_item)

    return {"id": new_item.id, "name": new_item.name, "value": new_item.value, "itemType": new_item.item_type}


@app.delete("/money/networth/{item_id}")
def delete_net_worth_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    deleted = (
        db.query(NetWorthItem)
        .filter(NetWorthItem.id == item_id, NetWorthItem.user_id == current_user.id)
        .delete()
    )

    db.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Net worth item not found")

    return {"message": "Net worth item deleted"}


FREE_TIER_GOAL_LIMIT = 1


class GoalCreateRequest(BaseModel):
    name: str
    target_amount: float = Field(gt=0)
    target_date: str | None = None


class GoalUpdateRequest(BaseModel):
    name: str | None = None
    target_amount: float | None = Field(default=None, gt=0)
    current_amount: float | None = Field(default=None, ge=0)
    target_date: str | None = None


def goal_response(goal: Goal) -> dict:
    return {
        "id": goal.id,
        "name": goal.name,
        "targetAmount": goal.target_amount,
        "currentAmount": goal.current_amount,
        "targetDate": goal.target_date,
    }


@app.get("/money/goals")
def get_goals(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    goals = (
        db.query(Goal)
        .filter(Goal.user_id == current_user.id)
        .order_by(Goal.created_at)
        .all()
    )

    return {
        "goals": [goal_response(g) for g in goals],
        "limit": None if has_tier(current_user, "plus") else FREE_TIER_GOAL_LIMIT,
    }


@app.post("/money/goals")
@limiter.limit("20/minute")
def create_goal(
    request: Request,
    payload: GoalCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    name = payload.name.strip()

    if name == "":
        raise HTTPException(status_code=400, detail="Goal name is required")

    existing_count = db.query(Goal).filter(Goal.user_id == current_user.id).count()

    if not has_tier(current_user, "plus") and existing_count >= FREE_TIER_GOAL_LIMIT:
        raise HTTPException(
            status_code=403,
            detail=f"Free accounts can track {FREE_TIER_GOAL_LIMIT} goal. Upgrade to Plus for unlimited goals."
        )

    new_goal = Goal(
        user_id=current_user.id,
        name=name,
        target_amount=payload.target_amount,
        current_amount=0.0,
        target_date=payload.target_date,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)

    return goal_response(new_goal)


@app.patch("/money/goals/{goal_id}")
@limiter.limit("30/minute")
def update_goal(
    request: Request,
    goal_id: int,
    payload: GoalUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    goal = (
        db.query(Goal)
        .filter(Goal.id == goal_id, Goal.user_id == current_user.id)
        .first()
    )

    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    if payload.name is not None:
        name = payload.name.strip()
        if name == "":
            raise HTTPException(status_code=400, detail="Goal name cannot be empty")
        goal.name = name

    if payload.target_amount is not None:
        goal.target_amount = payload.target_amount

    if payload.current_amount is not None:
        goal.current_amount = payload.current_amount

    if payload.target_date is not None:
        goal.target_date = payload.target_date or None

    db.commit()
    db.refresh(goal)

    return goal_response(goal)


@app.delete("/money/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    deleted = (
        db.query(Goal)
        .filter(Goal.id == goal_id, Goal.user_id == current_user.id)
        .delete()
    )

    db.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Goal not found")

    return {"message": "Goal deleted"}


# ---------------------------------------------------------------------------
# Portfolios: buy/sell ledger with derived holdings
# ---------------------------------------------------------------------------

FREE_TIER_PORTFOLIO_LIMIT = 1


def compute_holdings(transactions: list[dict]) -> dict:
    """Derives current holdings from a buy/sell ledger using the average-cost
    method: buys blend into a running average cost, sells reduce shares and
    realize P&L at (sell price - average cost) x shares sold.

    Pure so it can be unit tested directly. Transactions must be provided in
    chronological order. Raises ValueError when a sell exceeds held shares --
    that means the ledger itself is invalid.
    """
    holdings: dict[str, dict] = {}
    realized_gain_loss = 0.0

    for tx in transactions:
        symbol = tx["symbol"]
        position = holdings.get(symbol, {"shares": 0.0, "avgCost": 0.0})

        if tx["type"] == "buy":
            total_cost = position["shares"] * position["avgCost"] + tx["shares"] * tx["price"]
            new_shares = position["shares"] + tx["shares"]
            position = {"shares": new_shares, "avgCost": total_cost / new_shares}
        else:
            # Guard against float drift on "sell everything" (e.g. 3 buys of
            # 0.1 shares then one sell of 0.3).
            if tx["shares"] > position["shares"] + 1e-9:
                raise ValueError(
                    f"Cannot sell {tx['shares']} shares of {symbol}: only {position['shares']} held"
                )

            realized_gain_loss += (tx["price"] - position["avgCost"]) * tx["shares"]
            position = {
                "shares": position["shares"] - tx["shares"],
                "avgCost": position["avgCost"],
            }

        if position["shares"] <= 1e-9:
            holdings.pop(symbol, None)
        else:
            holdings[symbol] = position

    return {
        "holdings": holdings,
        "realizedGainLoss": round(realized_gain_loss, 2),
    }


class PortfolioCreateRequest(BaseModel):
    name: str


class PortfolioTransactionCreateRequest(BaseModel):
    symbol: str
    type: Literal["buy", "sell"]
    shares: float = Field(gt=0)
    price: float = Field(ge=0)
    date: str


def get_owned_portfolio(db: Session, user_id: int, portfolio_id: int) -> Portfolio:
    portfolio = (
        db.query(Portfolio)
        .filter(Portfolio.id == portfolio_id, Portfolio.user_id == user_id)
        .first()
    )

    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    return portfolio


def get_ledger(db: Session, portfolio_id: int) -> list[PortfolioTransaction]:
    """Chronological ledger for compute_holdings: same-date rows are ordered
    by insertion so a buy entered before a sell on one day stays first."""
    return (
        db.query(PortfolioTransaction)
        .filter(PortfolioTransaction.portfolio_id == portfolio_id)
        .order_by(PortfolioTransaction.date, PortfolioTransaction.id)
        .all()
    )


def ledger_dicts(rows: list[PortfolioTransaction]) -> list[dict]:
    return [
        {"symbol": row.symbol, "type": row.type, "shares": row.shares, "price": row.price}
        for row in rows
    ]


@app.get("/portfolios")
def list_portfolios(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    portfolios = (
        db.query(Portfolio)
        .filter(Portfolio.user_id == current_user.id)
        .order_by(Portfolio.created_at)
        .all()
    )

    return {
        "portfolios": [
            {
                "id": p.id,
                "name": p.name,
                "transactionCount": db.query(PortfolioTransaction)
                .filter(PortfolioTransaction.portfolio_id == p.id)
                .count(),
            }
            for p in portfolios
        ],
        "limit": None if has_tier(current_user, "plus") else FREE_TIER_PORTFOLIO_LIMIT,
    }


@app.post("/portfolios")
@limiter.limit("10/minute")
def create_portfolio(
    request: Request,
    payload: PortfolioCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    name = payload.name.strip()

    if name == "":
        raise HTTPException(status_code=400, detail="Portfolio name is required")

    existing_count = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).count()

    if not has_tier(current_user, "plus") and existing_count >= FREE_TIER_PORTFOLIO_LIMIT:
        raise HTTPException(
            status_code=403,
            detail=f"Free accounts can have {FREE_TIER_PORTFOLIO_LIMIT} portfolio. Upgrade to Plus for unlimited portfolios."
        )

    new_portfolio = Portfolio(
        user_id=current_user.id,
        name=name,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    db.add(new_portfolio)
    db.commit()
    db.refresh(new_portfolio)

    return {"id": new_portfolio.id, "name": new_portfolio.name, "transactionCount": 0}


@app.delete("/portfolios/{portfolio_id}")
def delete_portfolio(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    portfolio = get_owned_portfolio(db, current_user.id, portfolio_id)

    db.query(PortfolioTransaction).filter(
        PortfolioTransaction.portfolio_id == portfolio.id
    ).delete()
    db.delete(portfolio)
    db.commit()

    return {"message": "Portfolio deleted"}


@app.get("/portfolios/{portfolio_id}")
def get_portfolio(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    portfolio = get_owned_portfolio(db, current_user.id, portfolio_id)
    ledger = get_ledger(db, portfolio.id)

    computed = compute_holdings(ledger_dicts(ledger))

    holdings = []
    total_market_value = 0.0
    total_cost_basis = 0.0
    priced_market_value = 0.0

    for symbol, position in computed["holdings"].items():
        try:
            info = yf.Ticker(symbol).info
        except Exception:
            info = {}

        current_price = info.get("currentPrice") or info.get("regularMarketPrice")
        cost_basis = position["shares"] * position["avgCost"]
        market_value = position["shares"] * current_price if current_price is not None else None

        gain_loss = None
        gain_loss_percent = None

        if market_value is not None:
            gain_loss = market_value - cost_basis
            gain_loss_percent = round(gain_loss / cost_basis * 100, 2) if cost_basis > 0 else None
            total_market_value += market_value
            priced_market_value += market_value

        total_cost_basis += cost_basis

        holdings.append({
            "symbol": symbol,
            "name": info.get("shortName") or info.get("longName") or symbol,
            "shares": round(position["shares"], 6),
            "avgCost": round(position["avgCost"], 4),
            "currentPrice": current_price,
            "marketValue": round(market_value, 2) if market_value is not None else None,
            "gainLoss": round(gain_loss, 2) if gain_loss is not None else None,
            "gainLossPercent": gain_loss_percent,
        })

    total_gain_loss = total_market_value - total_cost_basis if holdings else 0.0

    # Allocation only covers holdings with a live price; unpriced positions
    # can't be weighted meaningfully.
    allocation = [
        {
            "symbol": h["symbol"],
            "percent": round(h["marketValue"] / priced_market_value * 100, 2),
        }
        for h in holdings
        if h["marketValue"] is not None and priced_market_value > 0
    ]

    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "holdings": holdings,
        "totals": {
            "marketValue": round(total_market_value, 2),
            "costBasis": round(total_cost_basis, 2),
            "gainLoss": round(total_gain_loss, 2),
            "gainLossPercent": (
                round(total_gain_loss / total_cost_basis * 100, 2)
                if total_cost_basis > 0
                else None
            ),
            "realizedGainLoss": computed["realizedGainLoss"],
        },
        "allocation": allocation,
    }


@app.get("/portfolios/{portfolio_id}/transactions")
def list_portfolio_transactions(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    portfolio = get_owned_portfolio(db, current_user.id, portfolio_id)

    rows = (
        db.query(PortfolioTransaction)
        .filter(PortfolioTransaction.portfolio_id == portfolio.id)
        .order_by(PortfolioTransaction.date.desc(), PortfolioTransaction.id.desc())
        .all()
    )

    return {
        "transactions": [
            {
                "id": row.id,
                "symbol": row.symbol,
                "type": row.type,
                "shares": row.shares,
                "price": row.price,
                "date": row.date,
            }
            for row in rows
        ]
    }


@app.post("/portfolios/{portfolio_id}/transactions")
@limiter.limit("30/minute")
def create_portfolio_transaction(
    request: Request,
    portfolio_id: int,
    payload: PortfolioTransactionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    portfolio = get_owned_portfolio(db, current_user.id, portfolio_id)
    symbol = payload.symbol.strip().upper()

    if symbol == "":
        raise HTTPException(status_code=400, detail="No symbol provided")

    try:
        info = yf.Ticker(symbol).info
        if not (info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")):
            raise HTTPException(status_code=400, detail="Could not find that stock symbol")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not find that stock symbol")

    # Validate the whole ledger with the new transaction merged in at its
    # chronological position, so a sell can never exceed what the portfolio
    # actually held as of its date.
    merged = [
        {"symbol": r.symbol, "type": r.type, "shares": r.shares, "price": r.price,
         "date": r.date, "id": r.id}
        for r in get_ledger(db, portfolio.id)
    ]
    merged.append({
        "symbol": symbol, "type": payload.type, "shares": payload.shares,
        "price": payload.price, "date": payload.date, "id": float("inf"),
    })
    merged.sort(key=lambda t: (t["date"], t["id"]))

    try:
        compute_holdings(merged)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    new_tx = PortfolioTransaction(
        portfolio_id=portfolio.id,
        symbol=symbol,
        type=payload.type,
        shares=payload.shares,
        price=payload.price,
        date=payload.date,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    db.add(new_tx)
    db.commit()
    db.refresh(new_tx)

    return {
        "id": new_tx.id,
        "symbol": new_tx.symbol,
        "type": new_tx.type,
        "shares": new_tx.shares,
        "price": new_tx.price,
        "date": new_tx.date,
    }


@app.delete("/portfolios/{portfolio_id}/transactions/{transaction_id}")
def delete_portfolio_transaction(
    portfolio_id: int,
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    portfolio = get_owned_portfolio(db, current_user.id, portfolio_id)

    target = (
        db.query(PortfolioTransaction)
        .filter(
            PortfolioTransaction.id == transaction_id,
            PortfolioTransaction.portfolio_id == portfolio.id,
        )
        .first()
    )

    if target is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Deleting a buy that later sells depend on would corrupt the ledger --
    # validate the remaining ledger before committing.
    remaining = [row for row in get_ledger(db, portfolio.id) if row.id != target.id]

    try:
        compute_holdings(ledger_dicts(remaining))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete this transaction: later sells would exceed the shares held. Delete the sells first."
        )

    db.delete(target)
    db.commit()

    return {"message": "Transaction deleted"}


@app.post("/stocks/backtest")
@limiter.limit("20/minute")
def backtest_stock(request: Request, payload: BacktestRequest):
    try:
        symbol = payload.symbol.strip().upper()

        if symbol == "":
            return {"error": "No stock symbol provided"}

        start_date = datetime.strptime(payload.startDate, "%Y-%m-%d").date()
        today = date.today()

        if start_date > today:
            return {"error": "Start date cannot be in the future"}

        ticker = yf.Ticker(symbol)

        # auto_adjust=False keeps "Close" split-adjusted (Yahoo applies that at the
        # source permanently) but NOT dividend-adjusted, so dividends can be
        # reinvested explicitly below instead of being baked into the price.
        history = ticker.history(
            start=start_date.isoformat(),
            end=(today + timedelta(days=1)).isoformat(),
            auto_adjust=False,
            actions=True
        )

        if history.empty:
            return {"error": "No historical price data found"}

        prices = history["Close"].dropna()
        prices.index = pd.to_datetime(prices.index).tz_localize(None).normalize()
        prices = prices[~prices.index.duplicated(keep="last")]

        if prices.empty:
            return {"error": "No closing price data found"}

        dividends = history["Dividends"] if "Dividends" in history.columns else pd.Series(dtype=float)
        dividends.index = pd.to_datetime(dividends.index).tz_localize(None).normalize()
        dividends = dividends[dividends > 0]
        dividends = dividends[~dividends.index.duplicated(keep="last")]

        try:
            currency = ticker.info.get("currency", "")
        except Exception:
            currency = ""

        latest_available_trading_day = prices.index[-1].date()

        def get_price_on_or_after(target_date: date):
            target_timestamp = pd.Timestamp(target_date)
            available_prices = prices[prices.index >= target_timestamp]

            if available_prices.empty:
                return None, None

            buy_date = available_prices.index[0]
            buy_price = float(available_prices.iloc[0])

            return buy_date.date(), buy_price

        cash_by_buy_date = defaultdict(float)
        source_by_buy_date = defaultdict(list)

        def schedule_investment(target_date: date, amount: float, source: str):
            if amount <= 0:
                return

            buy_date, buy_price = get_price_on_or_after(target_date)

            if buy_date is None or buy_price is None:
                return

            cash_by_buy_date[buy_date] += amount
            source_by_buy_date[buy_date].append(source)

        # Initial principal investment. get_price_on_or_after moves the purchase
        # to the next available trading day whenever the target date falls on a
        # weekend or market holiday, since `prices` only contains real trading days.
        schedule_investment(start_date, payload.principal, "initial")

        # Recurring investments -- same next-trading-day rule applies to each one.
        recurring_date = add_period(start_date, payload.recurringFrequency)

        while recurring_date <= latest_available_trading_day:
            schedule_investment(
                recurring_date,
                payload.recurringAmount,
                payload.recurringFrequency
            )

            recurring_date = add_period(recurring_date, payload.recurringFrequency)

        # Merge buy dates and dividend ex-dates into one chronological timeline so
        # each dividend is reinvested using the number of shares actually held at
        # that point in the simulation, not the final share count.
        event_dates = sorted(
            set(cash_by_buy_date.keys()) | set(d.date() for d in dividends.index)
        )

        total_shares = 0.0
        total_invested = 0.0
        total_dividends_received = 0.0
        transactions = []
        shares_delta_by_date = defaultdict(float)

        for event_date in event_dates:
            event_timestamp = pd.Timestamp(event_date)

            # Dividends are paid on shares held coming into the ex-dividend date,
            # so reinvest them before that day's scheduled purchase (if any).
            if event_timestamp in dividends.index and total_shares > 0:
                dividend_per_share = float(dividends.loc[event_timestamp])
                dividend_price = float(prices.loc[event_timestamp])
                dividend_cash = total_shares * dividend_per_share
                dividend_shares = dividend_cash / dividend_price

                total_shares += dividend_shares
                total_dividends_received += dividend_cash
                shares_delta_by_date[event_date] += dividend_shares

                transactions.append({
                    "date": event_date.isoformat(),
                    "amount": round(dividend_cash, 2),
                    "price": round(dividend_price, 4),
                    "shares": round(dividend_shares, 6),
                    "type": "dividend reinvestment"
                })

            if event_date in cash_by_buy_date:
                amount = cash_by_buy_date[event_date]
                buy_price = float(prices.loc[event_timestamp])
                shares_bought = amount / buy_price

                total_shares += shares_bought
                total_invested += amount
                shares_delta_by_date[event_date] += shares_bought

                sources = sorted(set(source_by_buy_date[event_date]))

                transactions.append({
                    "date": event_date.isoformat(),
                    "amount": round(amount, 2),
                    "price": round(buy_price, 4),
                    "shares": round(shares_bought, 6),
                    "type": " + ".join(sources)
                })

        latest_price = float(prices.iloc[-1])
        latest_date = prices.index[-1].date().isoformat()

        current_value = total_shares * latest_price
        gain_loss = current_value - total_invested

        if total_invested > 0:
            gain_loss_percent = (gain_loss / total_invested) * 100
        else:
            gain_loss_percent = 0

        # Portfolio value at every trading day (not just event days) for the
        # value-over-time chart. Skips days before the first purchase rather
        # than plotting a flat $0 lead-in.
        portfolio_value_history = []
        running_shares = 0.0

        for timestamp in prices.index:
            day = timestamp.date()
            running_shares += shares_delta_by_date.get(day, 0.0)

            if running_shares > 0:
                portfolio_value_history.append({
                    "date": day.isoformat(),
                    "value": round(running_shares * float(prices.loc[timestamp]), 2),
                })

        # Downsample long backtests so the response/chart payload stays small --
        # a 10-year daily backtest would otherwise be ~2,500 points.
        MAX_CHART_POINTS = 180
        if len(portfolio_value_history) > MAX_CHART_POINTS:
            step = len(portfolio_value_history) / MAX_CHART_POINTS
            sampled = [
                portfolio_value_history[int(i * step)] for i in range(MAX_CHART_POINTS)
            ]
            sampled[-1] = portfolio_value_history[-1]
            portfolio_value_history = sampled

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
            "totalDividendsReceived": round(total_dividends_received, 2),
            "totalTransactions": len(transactions),
            "transactions": transactions,
            "portfolioValueHistory": portfolio_value_history,
            "notes": [
                "Multiple investments on the same trading day are combined into one transaction.",
                "If the selected start date is before the stock's first available trading day, investments are moved to the first available trading day.",
                "If a recurring investment date falls on a weekend or market holiday, it is moved to the next available trading day.",
                "Cash dividends are assumed to be reinvested in full on the ex-dividend date at that day's closing price.",
                "Historical prices are split-adjusted at the source; dividends are added back explicitly instead of through price adjustment."
            ]
        }

    except ValueError:
        return {"error": "Invalid date format. Use YYYY-MM-DD"}

    except Exception as e:
        return log_and_generic_error(e, "Failed to calculate backtest.", "backtest_stock")

@app.get("/stocks/search")
@limiter.limit("60/minute")
def search_stocks(request: Request, q: str = Query("")):
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
        return log_and_generic_error(e, "Failed to fetch from Yahoo Finance.", "search_stocks")
    
@app.get("/stocks/price")
@limiter.limit("60/minute")
def get_stock_price(request: Request, symbol: str = Query("")):
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
        return log_and_generic_error(e, "Failed to fetch stock price.", "get_stock_price")


def _extract_news_item(item: dict):
    content = item.get("content", item)
    title = content.get("title")

    if not title:
        return None

    provider = content.get("provider") or {}
    canonical_url = content.get("canonicalUrl") or {}

    sentiment_label, sentiment_score = classify_headline_sentiment(title)

    return {
        "title": title,
        "publisher": provider.get("displayName"),
        "link": canonical_url.get("url"),
        "publishedAt": content.get("pubDate"),
        "sentiment": sentiment_label,
        "sentimentScore": sentiment_score,
    }


def _valuation_label(trailing_pe):
    if trailing_pe is None:
        return "Unknown"

    if trailing_pe < 15:
        return "Low"

    if trailing_pe <= 30:
        return "Fair"

    return "High"


def _recommendation_phrase(recommendation_key):
    phrases = {
        "strong_buy": "Analysts strongly favor this stock",
        "buy": "Analysts generally favor this stock",
        "hold": "Analysts are neutral on this stock",
        "sell": "Analysts generally caution against this stock",
        "strong_sell": "Analysts strongly caution against this stock",
    }

    return phrases.get(recommendation_key, "No clear analyst consensus is available")


@app.get("/stocks/analysis")
@limiter.limit("30/minute")
def get_stock_analysis(request: Request, symbol: str = Query(""), current_user=Depends(get_optional_user)):
    symbol = symbol.strip().upper()

    # The chart is a Plus unlock (organizing/history); the analyst gauge and
    # news sentiment are Pro unlocks (analysis); the statistical price
    # projection is an Ultimate unlock (advanced analytics/coaching).
    has_plus = has_tier(current_user, "plus")
    has_pro = has_tier(current_user, "pro")
    has_ultimate = has_tier(current_user, "ultimate")

    if symbol == "":
        return {"error": "No symbol provided"}

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        fundamentals = {
            "trailingPE": info.get("trailingPE"),
            "forwardPE": info.get("forwardPE"),
            "dividendYield": info.get("dividendYield"),
            "beta": info.get("beta"),
            "profitMargins": info.get("profitMargins"),
            "revenueGrowth": info.get("revenueGrowth"),
            "debtToEquity": info.get("debtToEquity"),
            "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
            "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
            "fiftyDayAverage": info.get("fiftyDayAverage"),
        }

        analyst = {
            "recommendationKey": info.get("recommendationKey"),
            "recommendationMean": info.get("recommendationMean"),
            "numberOfAnalystOpinions": info.get("numberOfAnalystOpinions"),
            "targetMeanPrice": info.get("targetMeanPrice"),
            "targetHighPrice": info.get("targetHighPrice"),
            "targetLowPrice": info.get("targetLowPrice"),
        }

        news = []

        try:
            for item in (ticker.news or [])[:5]:
                news_item = _extract_news_item(item)

                if news_item:
                    news.append(news_item)
        except Exception:
            news = []

        # Analyst consensus (the gauge) and news sentiment coloring are Pro
        # features -- lower tiers still see the raw fundamentals, headlines,
        # and beginner summary, just without those two enrichments.
        if not has_pro:
            analyst = {key: None for key in analyst}

            for news_item in news:
                news_item["sentiment"] = None
                news_item["sentimentScore"] = None

        # Price history (the chart) is a Plus feature -- skip the extra network
        # call entirely for free users rather than fetching and discarding it.
        price_history = []

        if has_plus:
            try:
                history = ticker.history(period="6mo", interval="1d")
                closes = history["Close"].dropna()

                for timestamp, close_price in closes.items():
                    price_history.append({
                        "date": pd.Timestamp(timestamp).date().isoformat(),
                        "close": round(float(close_price), 4),
                    })
            except Exception:
                price_history = []

        summary = []

        trailing_pe = fundamentals["trailingPE"]

        if trailing_pe is not None:
            summary.append(
                f"Valuation: {_valuation_label(trailing_pe)} "
                f"(trailing P/E of {round(trailing_pe, 2)})."
            )
        else:
            summary.append("Valuation: Unknown (no P/E data available).")

        analyst_opinions = analyst["numberOfAnalystOpinions"]
        analyst_sentence = _recommendation_phrase(analyst["recommendationKey"])

        if analyst_opinions:
            analyst_sentence += f", based on {analyst_opinions} analyst opinions."
        else:
            analyst_sentence += "."

        summary.append(analyst_sentence)

        profit_margins = fundamentals["profitMargins"]

        if profit_margins is not None:
            margin_percent = round(profit_margins * 100, 2)

            if profit_margins > 0:
                summary.append(f"Profitable (profit margin {margin_percent}%).")
            else:
                summary.append(f"Currently unprofitable (profit margin {margin_percent}%).")

        revenue_growth = fundamentals["revenueGrowth"]

        if revenue_growth is not None:
            growth_percent = round(revenue_growth * 100, 2)

            if revenue_growth > 0:
                summary.append(f"Revenue is growing ({growth_percent}% year-over-year).")
            else:
                summary.append(f"Revenue is shrinking ({growth_percent}% year-over-year).")

        beta = fundamentals["beta"]

        if beta is not None and beta > 1.5:
            summary.append(f"More volatile than the overall market (beta of {round(beta, 2)}).")

        return {
            "symbol": symbol,
            "name": info.get("shortName") or info.get("longName") or symbol,
            "fundamentals": fundamentals,
            "analyst": analyst,
            "news": news,
            "summary": summary,
            "priceHistory": price_history,
            "unlocks": {
                "priceHistory": has_plus,
                "analystConsensus": has_pro,
                "newsSentiment": has_pro,
                "priceProjection": has_ultimate,
            },
            "disclaimer": "Educational information only, not financial advice.",
        }

    except Exception as e:
        return log_and_generic_error(e, "Failed to fetch stock analysis.", "get_stock_analysis")


class RecommendationRequest(BaseModel):
    initialAmount: float = Field(ge=0)
    monthlyIncome: float = Field(ge=0)
    monthlySavings: float = Field(ge=0)
    hasEmergencyFund: bool
    hasHighInterestDebt: bool
    horizon: Literal["short", "medium", "long"]
    riskReaction: Literal["sell", "hold", "buy_more"]
    # The user's NEED for cash payouts from the account -- not a strategy
    # preference. "none" = reinvest everything, "primary" = counting on
    # regular payouts.
    incomeNeed: Literal["none", "some", "primary"]
    experience: Literal["new", "some", "experienced"]


# Broad, low-cost index/bond funds -- these are deliberately NOT "discovered"
# from a screener. Their entire value as a core holding IS being standard,
# diversified, and boring; there's no benefit to surfacing an obscure ETF here.
CORE_ETFS = [
    {"symbol": "VOO", "category": "broad_etf"},
    {"symbol": "VTI", "category": "broad_etf"},
    {"symbol": "QQQ", "category": "broad_etf"},
    {"symbol": "VXUS", "category": "intl_etf"},
    {"symbol": "BND", "category": "bond_etf"},
    {"symbol": "AGG", "category": "bond_etf"},
    # Dividend ETFs give an income-need profile a coherent fund answer
    # instead of forcing a choice between bonds and single dividend stocks.
    {"symbol": "SCHD", "category": "dividend_etf"},
    {"symbol": "VYM", "category": "dividend_etf"},
]

CORE_CATEGORY_RISK = {
    "broad_etf": "medium",
    "intl_etf": "medium",
    "bond_etf": "low",
    "dividend_etf": "medium",
}

# GICS-style sectors as Yahoo's screener defines them (yf.EquityQuery('eq',
# ['sector', ...]).valid_values). Individual stock picks are discovered live
# from these rather than a hand-picked list, so recommendations span the real
# market instead of repeating the same handful of household names.
SECTORS = [
    "Technology", "Healthcare", "Financial Services", "Consumer Defensive",
    "Consumer Cyclical", "Industrials", "Energy", "Communication Services",
    "Utilities", "Basic Materials", "Real Estate",
]

MAIN_US_EXCHANGES = ["NMS", "NYQ", "NGM", "ASE", "NCM"]

# Two size tiers per sector: "large" for established, lower-idiosyncratic-risk
# names, "mid" for smaller/growthier names. A hard market-cap floor on the mid
# tier keeps this away from penny stocks and illiquid names -- Yahoo's own
# "aggressive_small_caps" screener was tested and surfaced sub-$100M stocks
# trading under $1, which isn't appropriate to suggest to a beginner investor.
SIZE_TIERS = [
    ("large", 10_000_000_000, None),
    ("mid", 1_000_000_000, 10_000_000_000),
]

SECTOR_PICKS_PER_QUERY = 6


def discover_sector_candidates():
    """Query Yahoo's live screener per sector/size-tier. Returns raw
    (symbol, sector, sizeTier) entries, deduplicated by symbol. Any screener
    call that errors (rate limit, transient network issue) is skipped rather
    than failing the whole request -- a partial universe is fine here."""
    discovered = {}

    for sector in SECTORS:
        for size_tier, min_cap, max_cap in SIZE_TIERS:
            try:
                criteria = [
                    yf.EquityQuery("eq", ["sector", sector]),
                    yf.EquityQuery("is-in", ["exchange", *MAIN_US_EXCHANGES]),
                ]

                if max_cap is not None:
                    criteria.append(yf.EquityQuery("btwn", ["intradaymarketcap", min_cap, max_cap]))
                else:
                    criteria.append(yf.EquityQuery("gt", ["intradaymarketcap", min_cap]))

                query = yf.EquityQuery("and", criteria)
                result = yf.screen(query, sortField="intradaymarketcap", sortAsc=False, size=SECTOR_PICKS_PER_QUERY)
                quotes = result.get("quotes", []) if result else []
            except Exception:
                quotes = []

            for quote in quotes:
                symbol = quote.get("symbol")

                # Skip preferred shares / secondary share classes (e.g. "JPM-PC",
                # "PBR-A") -- not appropriate picks for a beginner audience.
                if not symbol or "-" in symbol:
                    continue

                if symbol not in discovered:
                    discovered[symbol] = {"symbol": symbol, "sector": sector, "sizeTier": size_tier}

    return list(discovered.values())


def normalize_company_name(name):
    if not name:
        return ""

    normalized = re.sub(r"[^a-z0-9 ]", "", name.lower())

    for suffix in [
        " incorporated", " inc", " corporation", " corp", " company", " co",
        " limited", " ltd", " holdings", " holding", " group", " plc",
        " class a", " class b", " class c", " sa", " ag", " nv", " se",
    ]:
        normalized = normalized.replace(suffix, "")

    return normalized.strip()


def classify_style(info, sector):
    """Data-driven investment style, derived from real fundamentals rather
    than a hand-assigned tag -- growth/value/dividend/defensive/core."""
    dividend_yield = info.get("dividendYield")
    trailing_pe = info.get("trailingPE")
    revenue_growth = info.get("revenueGrowth")
    profit_margins = info.get("profitMargins")
    beta = info.get("beta")

    if dividend_yield is not None and dividend_yield > 2.0:
        return "dividend"

    if revenue_growth is not None and revenue_growth > 0.15:
        return "growth"

    if (
        trailing_pe is not None and 0 < trailing_pe < 18
        and profit_margins is not None and profit_margins > 0
    ):
        return "value"

    if sector in ("Utilities", "Consumer Defensive", "Healthcare", "Real Estate") and (
        beta is None or beta < 1.0
    ):
        return "defensive"

    return "core"


def classify_risk_bucket(info, size_tier):
    beta = info.get("beta")

    if beta is None:
        base = "medium"
    elif beta >= 1.3:
        base = "high"
    elif beta < 0.8:
        base = "low"
    else:
        base = "medium"

    # Smaller companies carry idiosyncratic risk that beta alone understates.
    if size_tier == "mid":
        if base == "low":
            base = "medium"
        elif base == "medium":
            base = "high"

    return base


# Common rule-of-thumb starting allocations by risk profile and time horizon.
# General personal-finance education, not a personalized allocation.
ALLOCATION_TABLE = {
    "conservative": {
        "short": {"stocks": 20, "bonds": 70, "cash": 10},
        "medium": {"stocks": 35, "bonds": 55, "cash": 10},
        "long": {"stocks": 45, "bonds": 50, "cash": 5},
    },
    "moderate": {
        "short": {"stocks": 40, "bonds": 50, "cash": 10},
        "medium": {"stocks": 60, "bonds": 35, "cash": 5},
        "long": {"stocks": 75, "bonds": 22, "cash": 3},
    },
    "aggressive": {
        "short": {"stocks": 55, "bonds": 35, "cash": 10},
        "medium": {"stocks": 75, "bonds": 20, "cash": 5},
        "long": {"stocks": 90, "bonds": 10, "cash": 0},
    },
}

_universe_cache = {"stocks": None, "core": None, "fetched_at": None}
UNIVERSE_CACHE_TTL_MINUTES = 15


def _fetch_info(symbol):
    try:
        return symbol, yf.Ticker(symbol).info
    except Exception:
        return symbol, {}


def get_universe_data():
    now = datetime.now(timezone.utc)

    if (
        _universe_cache["stocks"] is not None
        and _universe_cache["fetched_at"] is not None
        and now - _universe_cache["fetched_at"] < timedelta(minutes=UNIVERSE_CACHE_TTL_MINUTES)
    ):
        return _universe_cache["stocks"], _universe_cache["core"]

    raw_candidates = discover_sector_candidates()
    symbols_to_fetch = [c["symbol"] for c in raw_candidates] + [e["symbol"] for e in CORE_ETFS]

    info_by_symbol = {}
    with ThreadPoolExecutor(max_workers=12) as executor:
        for symbol, info in executor.map(_fetch_info, symbols_to_fetch):
            info_by_symbol[symbol] = info

    enriched_stocks = []

    for candidate in raw_candidates:
        info = info_by_symbol.get(candidate["symbol"], {})

        if not info.get("regularMarketPrice") and not info.get("currentPrice"):
            continue  # delisted/no data -- skip rather than show a broken card

        # US-exchange-listed does not mean US-domiciled -- foreign ADRs (Korean
        # telecoms, Brazilian utilities, Cyprus shippers) kept surfacing near
        # the top of the dividend bucket purely on yield. Foreign withholding
        # tax and unfamiliar reporting make them a poor default for a
        # beginner-focused tool, so the individual-stock pool sticks to
        # US-domiciled companies; core ETFs already cover intl exposure (VXUS).
        if info.get("country") not in (None, "United States"):
            continue

        enriched_stocks.append({
            "symbol": candidate["symbol"],
            "sector": candidate["sector"],
            "sizeTier": candidate["sizeTier"],
            "style": classify_style(info, candidate["sector"]),
            "riskBucket": classify_risk_bucket(info, candidate["sizeTier"]),
            "name": info.get("shortName") or info.get("longName") or candidate["symbol"],
            "normalizedName": normalize_company_name(info.get("shortName") or info.get("longName") or ""),
            "price": info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose"),
            "currency": info.get("currency", ""),
            "marketCap": info.get("marketCap"),
            "dividendYield": info.get("dividendYield"),
            "trailingPE": info.get("trailingPE"),
            "beta": info.get("beta"),
            "revenueGrowth": info.get("revenueGrowth"),
            "profitMargins": info.get("profitMargins"),
        })

    # Dual share classes (GOOGL/GOOG) and cross-listed duplicates normalize to
    # the same name -- keep only the largest by market cap.
    deduped_by_name = {}
    for stock in enriched_stocks:
        key = stock["normalizedName"] or stock["symbol"]
        existing = deduped_by_name.get(key)
        if existing is None or (stock["marketCap"] or 0) > (existing["marketCap"] or 0):
            deduped_by_name[key] = stock

    enriched_core = []

    for entry in CORE_ETFS:
        info = info_by_symbol.get(entry["symbol"], {})

        enriched_core.append({
            "symbol": entry["symbol"],
            "category": entry["category"],
            "riskBucket": CORE_CATEGORY_RISK[entry["category"]],
            "name": info.get("shortName") or info.get("longName") or entry["symbol"],
            "price": info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose"),
            "currency": info.get("currency", ""),
            "dividendYield": info.get("dividendYield"),
            "trailingPE": info.get("trailingPE"),
            "beta": info.get("beta"),
        })

    stocks = list(deduped_by_name.values())

    _universe_cache["stocks"] = stocks
    _universe_cache["core"] = enriched_core
    _universe_cache["fetched_at"] = now

    return stocks, enriched_core


def determine_risk_profile(risk_reaction: str, horizon: str):
    reaction_points = {"sell": 0, "hold": 1, "buy_more": 2}[risk_reaction]
    horizon_points = {"short": 0, "medium": 1, "long": 2}[horizon]
    total = reaction_points + horizon_points

    if total <= 1:
        return "conservative"

    if total <= 2:
        return "moderate"

    return "aggressive"


RISK_ADJACENCY = {"low": 0, "medium": 1, "high": 2}


def _risk_score(risk_bucket, target_risk_bucket):
    risk_distance = abs(RISK_ADJACENCY[risk_bucket] - RISK_ADJACENCY[target_risk_bucket])

    if risk_distance == 0:
        return 3

    if risk_distance == 1:
        return 1

    return -2


# Style weights per (risk profile x income need) -- one explicit cell per
# combination rather than a formula, so every recommendation is auditable:
# "why did an aggressive investor with no payout need see a dividend stock?"
# should never happen, and this table is where that's guaranteed.
#
# Income need is the user's NEED (do they have to take cash out of the
# account), not a strategy preference. Where the need conflicts with the
# risk profile (e.g. aggressive + primary income), the need wins and the
# endpoint attaches an educational note about the trade-off.
STYLE_WEIGHTS = {
    ("aggressive", "none"): {"growth": 3.0, "core": 1.5, "value": 0.5, "defensive": -1.0, "dividend": -2.0},
    ("aggressive", "some"): {"growth": 2.5, "core": 1.5, "value": 0.5, "dividend": 1.0, "defensive": 0.0},
    ("aggressive", "primary"): {"dividend": 2.5, "defensive": 1.0, "value": 1.0, "core": 0.5, "growth": 0.0},
    ("moderate", "none"): {"growth": 2.0, "core": 2.0, "value": 1.0, "defensive": 0.0, "dividend": -1.0},
    ("moderate", "some"): {"core": 2.0, "growth": 1.5, "value": 1.0, "dividend": 1.5, "defensive": 0.5},
    ("moderate", "primary"): {"dividend": 2.5, "defensive": 1.5, "value": 1.0, "core": 0.5, "growth": -1.0},
    # Conservative investors would sell in a drawdown, so even with no income
    # need, high-beta growth is only mildly rewarded -- steadiness comes first.
    ("conservative", "none"): {"core": 2.0, "value": 1.5, "defensive": 1.5, "growth": 0.5, "dividend": 0.5},
    ("conservative", "some"): {"defensive": 2.0, "dividend": 1.5, "value": 1.5, "core": 1.0, "growth": -0.5},
    ("conservative", "primary"): {"dividend": 2.5, "defensive": 2.0, "value": 1.0, "core": 0.5, "growth": -1.5},
}

ETF_CATEGORY_WEIGHTS = {
    ("aggressive", "none"): {"broad_etf": 2.0, "intl_etf": 1.0, "bond_etf": -1.0, "dividend_etf": -1.0},
    ("aggressive", "some"): {"broad_etf": 2.0, "intl_etf": 1.0, "dividend_etf": 1.0, "bond_etf": -0.5},
    ("aggressive", "primary"): {"dividend_etf": 2.5, "broad_etf": 1.0, "bond_etf": 0.5, "intl_etf": 0.0},
    ("moderate", "none"): {"broad_etf": 2.0, "intl_etf": 1.0, "bond_etf": 0.5, "dividend_etf": -0.5},
    ("moderate", "some"): {"broad_etf": 1.5, "dividend_etf": 1.5, "bond_etf": 1.0, "intl_etf": 0.5},
    ("moderate", "primary"): {"dividend_etf": 2.5, "bond_etf": 1.5, "broad_etf": 0.5, "intl_etf": 0.0},
    ("conservative", "none"): {"broad_etf": 1.5, "bond_etf": 1.5, "intl_etf": 0.5, "dividend_etf": 0.5},
    ("conservative", "some"): {"bond_etf": 2.0, "dividend_etf": 1.5, "broad_etf": 1.0, "intl_etf": 0.0},
    ("conservative", "primary"): {"dividend_etf": 2.5, "bond_etf": 2.0, "broad_etf": 0.5, "intl_etf": -0.5},
}


def derive_style_weights(risk_profile: str, income_need: str) -> dict:
    return STYLE_WEIGHTS[(risk_profile, income_need)]


def max_picks_for_experience(experience: str) -> int:
    """New investors get fewer individual picks -- the core funds should do
    the heavy lifting until they've built confidence reading single stocks."""
    return {"new": 4, "some": 6, "experienced": 8}[experience]


def score_core_etf(candidate, target_risk_bucket, risk_profile, income_need):
    score = _risk_score(candidate["riskBucket"], target_risk_bucket)
    weights = ETF_CATEGORY_WEIGHTS[(risk_profile, income_need)]
    return score + weights.get(candidate["category"], 0)


def score_stock(candidate, target_risk_bucket, risk_profile, income_need):
    score = _risk_score(candidate["riskBucket"], target_risk_bucket)
    weights = derive_style_weights(risk_profile, income_need)
    score += weights.get(candidate["style"], 0)

    # Yield only matters when the user actually needs payouts -- rewarding
    # yield for a reinvest-everything profile is how dividend stocks used to
    # leak into aggressive growth recommendations.
    if candidate["dividendYield"] and income_need != "none":
        score += min(candidate["dividendYield"] / 2, 2)

    # Slight tilt toward established companies -- keeps even the "aggressive"
    # bucket from leaning entirely on smaller, more speculative names.
    if candidate["sizeTier"] == "large":
        score += 0.5

    return score


# Reasons reference the user's stated NEED, so every card answers
# "why am I being shown this?" in the user's own terms.
INCOME_NEED_PHRASES = {
    "none": "your plan to reinvest everything and let it compound",
    "some": "your preference for some cash payouts alongside growth",
    "primary": "your need for regular cash payouts",
}


def build_core_etf_reason(candidate, risk_profile, income_need):
    category_phrases = {
        "broad_etf": "a diversified fund spanning hundreds of U.S. companies",
        "intl_etf": "a diversified fund of international companies",
        "bond_etf": "a diversified bond fund",
        "dividend_etf": "a diversified fund of established dividend-paying companies",
    }

    return (
        f"{category_phrases.get(candidate['category'], 'A fund')} that matches "
        f"{INCOME_NEED_PHRASES.get(income_need, 'your goal')} and your {risk_profile} risk tolerance."
    )


def build_stock_reason(candidate, risk_profile, income_need):
    style = candidate["style"]
    sector = candidate.get("sector")

    style_phrases = {
        "growth": "a growth-focused company",
        "value": "a reasonably priced, profitable company",
        "dividend": "a company with an above-average dividend yield",
        "defensive": "a company in a historically steadier sector",
        "core": "an established company",
    }

    details = []

    if style == "growth" and candidate.get("revenueGrowth") is not None:
        details.append(f"revenue growing {round(candidate['revenueGrowth'] * 100, 1)}% year-over-year")

    if style == "dividend" and candidate.get("dividendYield") is not None:
        details.append(f"a {round(candidate['dividendYield'], 2)}% dividend yield")

    if style == "value" and candidate.get("trailingPE") is not None:
        details.append(f"a trailing P/E of {round(candidate['trailingPE'], 1)}")

    detail_text = f" ({'; '.join(details)})" if details else ""
    sector_text = f" in the {sector} sector" if sector else ""

    return (
        f"{style_phrases.get(style, 'A company')}{sector_text}{detail_text}, matching "
        f"{INCOME_NEED_PHRASES.get(income_need, 'your goal')} and your {risk_profile} risk tolerance."
    )


def build_profile_summary(risk_profile, horizon, income_need, experience):
    horizon_text = {
        "short": "you may need this money within a few years",
        "medium": "you have a medium time horizon",
        "long": "you have a long time horizon",
    }[horizon]

    need_text = {
        "none": "you don't need payouts, so we favored growth that compounds",
        "some": "you'd like some payouts, so we mixed growth with dividend payers",
        "primary": "you're counting on payouts, so we favored dividend payers and steadier funds",
    }[income_need]

    experience_text = {
        "new": " Since you're new to investing, most of the weight sits in diversified funds.",
        "some": "",
        "experienced": "",
    }[experience]

    return (
        f"Your profile: {risk_profile} risk tolerance, {horizon_text}, and {need_text}."
        f"{experience_text}"
    )


def select_diversified_picks(scored_stocks, count, max_per_sector=2):
    """Cap picks per sector so results actually span the market (tech, healthcare,
    financials, etc.) instead of clustering wherever the scores happen to be highest."""
    ranked = sorted(scored_stocks, key=lambda c: c["score"], reverse=True)
    picks = []
    sector_counts = defaultdict(int)

    for candidate in ranked:
        sector = candidate.get("sector") or "Other"

        if sector_counts[sector] >= max_per_sector:
            continue

        picks.append(candidate)
        sector_counts[sector] += 1

        if len(picks) >= count:
            break

    return picks


FREE_TIER_RECOMMENDATION_LIMIT = 2


@app.post("/stocks/recommendations")
@limiter.limit("10/minute")
def recommend_stocks(request: Request, payload: RecommendationRequest, current_user=Depends(get_optional_user)):
    try:
        # Personalized picks beyond the free sample are a Pro (analysis) feature.
        is_premium = has_tier(current_user, "pro")
        risk_profile = determine_risk_profile(payload.riskReaction, payload.horizon)
        target_risk_bucket = {"conservative": "low", "moderate": "medium", "aggressive": "high"}[risk_profile]

        notes = []

        if not payload.hasEmergencyFund:
            notes.append(
                "You mentioned you don't yet have a 3-6 month emergency fund. Most personal "
                "finance guidance suggests building that first, since it prevents having to "
                "sell investments at a bad time if an unexpected expense comes up."
            )

        if payload.hasHighInterestDebt:
            notes.append(
                "You mentioned having high-interest debt. Paying that down often provides a "
                "better guaranteed return than investing, since credit card interest rates "
                "usually exceed typical market returns."
            )

        if payload.monthlyIncome > 0 and payload.monthlySavings > payload.monthlyIncome * 0.5:
            notes.append(
                "The monthly amount you plan to invest is more than half of your monthly "
                "income -- double check this leaves enough room for essential expenses."
            )

        # The income NEED wins over the risk profile, but when they pull in
        # opposite directions the user deserves to know about the trade-off.
        if payload.incomeNeed == "primary" and risk_profile == "aggressive":
            notes.append(
                "You have a long runway and high comfort with risk, but asked for regular "
                "payouts -- so dividend payers lead these suggestions. Worth knowing: with "
                "time on your side, growth investments plus selling shares when you need "
                "cash is often more efficient than dividends, which are taxed as they arrive."
            )

        if payload.experience == "new":
            notes.append(
                "Since you're new to investing, we kept individual stock picks to a few "
                "established companies -- the diversified core funds are designed to do "
                "the heavy lifting."
            )

        stocks, core_etfs = get_universe_data()

        scored_core = [
            {**candidate, "score": score_core_etf(candidate, target_risk_bucket, risk_profile, payload.incomeNeed)}
            for candidate in core_etfs
        ]

        core_holdings = []
        broad_etf = max(
            (c for c in scored_core if c["category"] == "broad_etf"),
            key=lambda c: c["score"],
            default=None
        )
        if broad_etf:
            core_holdings.append(broad_etf)

        # A payout need earns a dividend fund seat regardless of risk profile.
        if payload.incomeNeed in ("some", "primary"):
            dividend_etf = max(
                (c for c in scored_core if c["category"] == "dividend_etf"),
                key=lambda c: c["score"],
                default=None
            )
            if dividend_etf:
                core_holdings.append(dividend_etf)

        if risk_profile != "aggressive":
            bond_etf = max(
                (c for c in scored_core if c["category"] == "bond_etf"),
                key=lambda c: c["score"],
                default=None
            )
            if bond_etf:
                core_holdings.append(bond_etf)

        # New investors get large caps only -- smaller "mid" tier names swing
        # harder and are harder to research when you're starting out.
        candidate_stocks = (
            [s for s in stocks if s["sizeTier"] == "large"]
            if payload.experience == "new"
            else stocks
        )

        scored_stocks = [
            {**candidate, "score": score_stock(candidate, target_risk_bucket, risk_profile, payload.incomeNeed)}
            for candidate in candidate_stocks
        ]

        individual_picks = select_diversified_picks(
            scored_stocks,
            count=max_picks_for_experience(payload.experience),
            max_per_sector=2,
        )
        total_picks_available = len(individual_picks)

        if not is_premium:
            individual_picks = individual_picks[:FREE_TIER_RECOMMENDATION_LIMIT]

        def core_response_item(candidate):
            return {
                "symbol": candidate["symbol"],
                "name": candidate["name"],
                "category": candidate["category"],
                "sector": None,
                "riskBucket": candidate["riskBucket"],
                "price": round(candidate["price"], 2) if candidate["price"] else None,
                "currency": candidate["currency"],
                "dividendYield": candidate["dividendYield"],
                "trailingPE": candidate["trailingPE"],
                "beta": candidate["beta"],
                "reason": build_core_etf_reason(candidate, risk_profile, payload.incomeNeed),
            }

        def stock_response_item(candidate):
            return {
                "symbol": candidate["symbol"],
                "name": candidate["name"],
                "category": candidate["style"],
                "sector": candidate["sector"],
                "riskBucket": candidate["riskBucket"],
                "price": round(candidate["price"], 2) if candidate["price"] else None,
                "currency": candidate["currency"],
                "dividendYield": candidate["dividendYield"],
                "trailingPE": candidate["trailingPE"],
                "beta": candidate["beta"],
                "reason": build_stock_reason(candidate, risk_profile, payload.incomeNeed),
            }

        allocation = ALLOCATION_TABLE[risk_profile][payload.horizon]

        return {
            "riskProfile": risk_profile,
            "profileSummary": build_profile_summary(
                risk_profile, payload.horizon, payload.incomeNeed, payload.experience
            ),
            "targetAllocation": allocation,
            "notes": notes,
            "coreHoldings": [core_response_item(c) for c in core_holdings],
            "recommendations": [stock_response_item(c) for c in individual_picks],
            "isPremiumUser": is_premium,
            "totalPicksAvailable": total_picks_available,
            "disclaimer": (
                "These suggestions are discovered live from Yahoo Finance's market screener "
                "across multiple sectors and scored against general rules of thumb -- they "
                "are educational, not personalized financial advice. Consider speaking with "
                "a licensed financial advisor before investing."
            ),
        }

    except Exception as e:
        return log_and_generic_error(e, "Failed to generate recommendations.", "recommend_stocks")


# ---------------------------------------------------------------------------
# Statistical price projection (Ultimate tier): a Monte Carlo range driven by
# the stock's own historical volatility, with the drift nudged (within a
# small, capped amount) by transparent technical/news/fundamental/analyst
# signals. This deliberately never outputs a single predicted price -- short
# term stock prices are close to a random walk, and a point prediction would
# both be wrong most of the time and read as financial advice despite the
# disclaimers. Every input that shapes the range is returned in the response
# so the projection is explainable, not a black box.
# ---------------------------------------------------------------------------

def compute_historical_stats(daily_closes: list) -> dict:
    """Annualized drift and volatility from a series of daily closing prices.
    Historical mean return is a notoriously noisy estimator of future drift,
    so it is shrunk 50% toward zero -- disclosed in the response, not hidden.
    Needs at least 2 closes; fewer returns zeros (caller should treat that as
    "insufficient data" upstream)."""
    if len(daily_closes) < 2:
        return {"annualDrift": 0.0, "annualVolatility": 0.0, "rawAnnualDrift": 0.0}

    closes = np.array(daily_closes, dtype=float)
    closes = closes[closes > 0]  # guard against bad/zero data points

    if len(closes) < 2:
        return {"annualDrift": 0.0, "annualVolatility": 0.0, "rawAnnualDrift": 0.0}

    log_returns = np.diff(np.log(closes))

    raw_annual_drift = float(np.mean(log_returns) * 252)
    annual_volatility = float(np.std(log_returns) * np.sqrt(252))

    DRIFT_SHRINKAGE = 0.5
    shrunk_drift = raw_annual_drift * DRIFT_SHRINKAGE

    return {
        "annualDrift": shrunk_drift,
        "annualVolatility": annual_volatility,
        "rawAnnualDrift": raw_annual_drift,
    }


def compute_rsi(closes: list, period: int = 14):
    """Standard 14-day Relative Strength Index. Returns None when there isn't
    enough history to compute it rather than guessing."""
    if len(closes) < period + 1:
        return None

    closes = np.array(closes, dtype=float)
    deltas = np.diff(closes)

    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])

    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0

    rs = avg_gain / avg_loss
    return float(100 - (100 / (1 + rs)))


def _clip_signal(value: float) -> float:
    return max(-1.0, min(1.0, value))


def momentum_signal(current_price, sma50, sma200) -> float:
    """+1 when price is above both moving averages with the shorter one
    leading (uptrend), -1 for the mirrored downtrend, shades between."""
    if current_price is None or sma50 is None or sma200 is None or sma200 == 0:
        return 0.0

    above_50 = 1 if current_price > sma50 else -1
    above_200 = 1 if current_price > sma200 else -1
    trend_aligned = 1 if sma50 > sma200 else -1

    return _clip_signal((above_50 + above_200 + trend_aligned) / 3)


def rsi_signal(rsi) -> float:
    """Mean-reversion nudge: extreme readings lean slightly AGAINST further
    movement in that direction, not with it -- an overbought stock is more
    likely to cool off than keep accelerating."""
    if rsi is None:
        return 0.0

    if rsi >= 70:
        return _clip_signal(-(rsi - 70) / 30)

    if rsi <= 30:
        return _clip_signal((30 - rsi) / 30)

    return 0.0


def sentiment_signal(average_compound_score) -> float:
    if average_compound_score is None:
        return 0.0

    return _clip_signal(average_compound_score)


def analyst_signal(recommendation_mean) -> float:
    """recommendationMean: 1=strong buy ... 5=strong sell -- rescaled so
    strong buy -> +1, hold (3) -> 0, strong sell -> -1."""
    if recommendation_mean is None:
        return 0.0

    return _clip_signal((3 - recommendation_mean) / 2)


def fundamentals_signal(revenue_growth) -> float:
    """tanh-compressed so an extreme outlier (e.g. 300% growth off a tiny
    base) can't dominate the composite score the way a raw value would."""
    if revenue_growth is None:
        return 0.0

    return _clip_signal(float(np.tanh(revenue_growth * 2)))


# Trend and sentiment are weighted heaviest -- they're the most directly
# forward-looking of the five; fundamentals momentum is a slower-moving
# backdrop and gets the least weight.
SIGNAL_WEIGHTS = {
    "momentum": 0.30,
    "sentiment": 0.25,
    "analyst": 0.20,
    "rsi": 0.15,
    "fundamentals": 0.10,
}


def compute_composite_score(signals: dict) -> float:
    total = sum(signals[key] * weight for key, weight in SIGNAL_WEIGHTS.items())
    return _clip_signal(total)


# The tilt is deliberately small -- the tool should nudge the range, never
# imply strong conviction about direction.
MAX_ANNUAL_DRIFT_TILT = 0.05
DRIFT_CLIP_BOUND = 0.30
MIN_ANNUAL_VOLATILITY = 0.05
MAX_ANNUAL_VOLATILITY = 2.0


def simulate_price_paths(
    current_price: float,
    annual_drift: float,
    annual_volatility: float,
    horizon_days: int,
    num_paths: int = 2000,
    rng=None,
) -> dict:
    """Vectorized geometric Brownian motion Monte Carlo. `rng` is an injectable
    numpy Generator so tests can seed it for deterministic assertions; a real
    request gets a fresh one."""
    if rng is None:
        rng = np.random.default_rng()

    annual_volatility = max(MIN_ANNUAL_VOLATILITY, min(MAX_ANNUAL_VOLATILITY, annual_volatility))
    annual_drift = max(-DRIFT_CLIP_BOUND, min(DRIFT_CLIP_BOUND, annual_drift))

    daily_drift = annual_drift / 252
    daily_vol = annual_volatility / np.sqrt(252)

    daily_shocks = rng.normal(
        loc=(daily_drift - 0.5 * daily_vol ** 2),
        scale=daily_vol,
        size=(num_paths, horizon_days),
    )

    cumulative_log_return = np.sum(daily_shocks, axis=1)
    final_prices = current_price * np.exp(cumulative_log_return)

    percentiles = np.percentile(final_prices, [5, 16, 50, 84, 95])

    return {
        "extremeLow": float(percentiles[0]),
        "low": float(percentiles[1]),
        "median": float(percentiles[2]),
        "high": float(percentiles[3]),
        "extremeHigh": float(percentiles[4]),
    }


PROJECTION_HORIZONS = {30, 90, 365}


@app.get("/stocks/price-projection")
@limiter.limit("20/minute")
def get_price_projection(
    request: Request,
    symbol: str = Query(""),
    horizonDays: int = Query(30),
    current_user: User = Depends(get_current_user),
):
    if not has_tier(current_user, "ultimate"):
        raise HTTPException(
            status_code=403,
            detail="Statistical price projections are an Ultimate feature. Upgrade to Ultimate to unlock this."
        )

    symbol = symbol.strip().upper()

    if symbol == "":
        return {"error": "No symbol provided"}

    if horizonDays not in PROJECTION_HORIZONS:
        raise HTTPException(status_code=400, detail="horizonDays must be one of 30, 90, or 365")

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        current_price = info.get("currentPrice") or info.get("regularMarketPrice")

        if current_price is None:
            return {"error": "Could not find a current price for that symbol"}

        history = ticker.history(period="1y", interval="1d")
        closes = history["Close"].dropna().tolist()

        if len(closes) < 30:
            return {"error": "Not enough price history for that symbol to build a projection"}

        stats = compute_historical_stats(closes)

        closes_array = np.array(closes)
        sma50 = float(np.mean(closes_array[-50:])) if len(closes_array) >= 50 else None
        sma200 = float(np.mean(closes_array[-200:])) if len(closes_array) >= 200 else None
        rsi = compute_rsi(closes)

        news_scores = []
        try:
            for item in (ticker.news or [])[:10]:
                news_item = _extract_news_item(item)
                if news_item and news_item["sentimentScore"] is not None:
                    news_scores.append(news_item["sentimentScore"])
        except Exception:
            news_scores = []

        avg_sentiment = float(np.mean(news_scores)) if news_scores else None
        recommendation_mean = info.get("recommendationMean")
        revenue_growth = info.get("revenueGrowth")

        signals = {
            "momentum": momentum_signal(current_price, sma50, sma200),
            "rsi": rsi_signal(rsi),
            "sentiment": sentiment_signal(avg_sentiment),
            "analyst": analyst_signal(recommendation_mean),
            "fundamentals": fundamentals_signal(revenue_growth),
        }

        composite_score = compute_composite_score(signals)
        signal_tilt = composite_score * MAX_ANNUAL_DRIFT_TILT
        adjusted_drift = stats["annualDrift"] + signal_tilt

        projection = simulate_price_paths(
            current_price=current_price,
            annual_drift=adjusted_drift,
            annual_volatility=stats["annualVolatility"],
            horizon_days=horizonDays,
        )

        def factor_note(name, reading, description):
            return {"name": name, "reading": reading, "note": description}

        factors = [
            factor_note(
                "Trend",
                "Uptrend" if signals["momentum"] > 0.2 else "Downtrend" if signals["momentum"] < -0.2 else "Neutral",
                "Price relative to its 50-day and 200-day moving averages.",
            ),
            factor_note(
                "Momentum (RSI)",
                f"{round(rsi, 1)}" if rsi is not None else "N/A",
                "14-day Relative Strength Index. Above 70 is often considered overbought, below 30 oversold.",
            ),
            factor_note(
                "News Sentiment",
                "Positive" if signals["sentiment"] > 0.1 else "Negative" if signals["sentiment"] < -0.1 else "Neutral",
                "Average tone of recent headlines about this company.",
            ),
            factor_note(
                "Analyst Consensus",
                _recommendation_phrase(info.get("recommendationKey")),
                "Current average analyst rating.",
            ),
            factor_note(
                "Revenue Growth",
                f"{round(revenue_growth * 100, 1)}%" if revenue_growth is not None else "N/A",
                "Year-over-year revenue growth trend.",
            ),
        ]

        return {
            "symbol": symbol,
            "name": info.get("shortName") or info.get("longName") or symbol,
            "currentPrice": round(current_price, 2),
            "horizonDays": horizonDays,
            "projection": {key: round(value, 2) for key, value in projection.items()},
            "methodology": {
                "annualVolatility": round(stats["annualVolatility"], 4),
                "baselineDrift": round(stats["annualDrift"], 4),
                "signalTilt": round(signal_tilt, 4),
                "compositeScore": round(composite_score, 3),
                "factors": factors,
            },
            "disclaimer": (
                "This is a statistical range derived from this stock's historical volatility "
                "and current technical/news signals -- it is not a forecast. Actual prices can "
                "and do fall outside this range. Educational information only, not financial advice."
            ),
        }

    except Exception as e:
        return log_and_generic_error(e, "Failed to build price projection.", "get_price_projection")

