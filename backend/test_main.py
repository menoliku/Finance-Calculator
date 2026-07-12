"""
Unit tests for the pure calculation logic in main.py -- date/period math,
sentiment classification, and the recommendation engine's scoring/risk rules.

Deliberately does NOT test the FastAPI endpoints themselves: those need a
live database and real yfinance network calls, which makes them slow and
flaky to assert against in CI. The functions tested here are the parts where
a silent bug would actually miscalculate someone's money or investment risk.
"""

from datetime import date

import main


# ---------------------------------------------------------------------------
# Date/period math (backtest scheduling)
# ---------------------------------------------------------------------------

def test_add_one_month_normal():
    assert main.add_one_month(date(2024, 1, 15)) == date(2024, 2, 15)


def test_add_one_month_december_rolls_over_to_next_year():
    assert main.add_one_month(date(2024, 12, 10)) == date(2025, 1, 10)


def test_add_one_month_clamps_day_to_shorter_month():
    # Jan 31 -> Feb has no 31st; should clamp to the 29th in a leap year.
    assert main.add_one_month(date(2024, 1, 31)) == date(2024, 2, 29)
    # ...and to the 28th in a non-leap year.
    assert main.add_one_month(date(2023, 1, 31)) == date(2023, 2, 28)


def test_add_one_year_normal():
    assert main.add_one_year(date(2023, 6, 1)) == date(2024, 6, 1)


def test_add_one_year_leap_day_falls_back_to_feb_28():
    assert main.add_one_year(date(2024, 2, 29)) == date(2025, 2, 28)


def test_add_period_daily():
    assert main.add_period(date(2024, 1, 1), "daily") == date(2024, 1, 2)


def test_add_period_weekly():
    assert main.add_period(date(2024, 1, 1), "weekly") == date(2024, 1, 8)


def test_add_period_monthly_matches_add_one_month():
    assert main.add_period(date(2024, 1, 31), "monthly") == date(2024, 2, 29)


def test_add_period_yearly_matches_add_one_year():
    assert main.add_period(date(2023, 6, 1), "yearly") == date(2024, 6, 1)


def test_add_period_unknown_frequency_falls_back_to_monthly():
    assert main.add_period(date(2024, 1, 15), "fortnightly") == date(2024, 2, 15)


# ---------------------------------------------------------------------------
# News headline sentiment
# ---------------------------------------------------------------------------

def test_sentiment_positive_finance_headline():
    label, score = main.classify_headline_sentiment("Apple beats Q3 estimates, stock surges")
    assert label == "positive"
    assert score > 0


def test_sentiment_negative_finance_headline():
    label, score = main.classify_headline_sentiment(
        "Company sued over skyrocketing prices, shares tumble"
    )
    assert label == "negative"
    assert score < 0


def test_sentiment_empty_text_is_neutral():
    label, score = main.classify_headline_sentiment("")
    assert label == "neutral"
    assert score == 0.0


# ---------------------------------------------------------------------------
# Analysis helper labels
# ---------------------------------------------------------------------------

def test_valuation_label_bands():
    assert main._valuation_label(None) == "Unknown"
    assert main._valuation_label(10) == "Low"
    assert main._valuation_label(20) == "Fair"
    assert main._valuation_label(50) == "High"


def test_recommendation_phrase_known_and_unknown_keys():
    assert "favor" in main._recommendation_phrase("buy")
    assert main._recommendation_phrase("not_a_real_key") == "No clear analyst consensus is available"


# ---------------------------------------------------------------------------
# Recommendation engine: risk profile derivation
# ---------------------------------------------------------------------------

def test_risk_profile_sell_and_short_horizon_is_conservative():
    assert main.determine_risk_profile("sell", "short") == "conservative"


def test_risk_profile_hold_and_medium_horizon_is_moderate():
    assert main.determine_risk_profile("hold", "medium") == "moderate"


def test_risk_profile_buy_more_and_long_horizon_is_aggressive():
    assert main.determine_risk_profile("buy_more", "long") == "aggressive"


# ---------------------------------------------------------------------------
# Recommendation engine: needs-based coherence
# ---------------------------------------------------------------------------

def test_weight_matrix_covers_every_profile_and_need_combination():
    for profile in ("conservative", "moderate", "aggressive"):
        for need in ("none", "some", "primary"):
            assert (profile, need) in main.STYLE_WEIGHTS
            assert (profile, need) in main.ETF_CATEGORY_WEIGHTS


def test_aggressive_with_no_income_need_favors_growth_over_dividends():
    weights = main.derive_style_weights("aggressive", "none")

    assert weights["growth"] > weights["core"]
    assert weights["growth"] > weights["value"]
    # The exact incoherence this redesign removes: dividend stocks must be
    # actively penalized, not just under-rewarded, for a reinvest-everything
    # aggressive profile.
    assert weights["dividend"] < 0
    assert weights["defensive"] < weights["growth"]


def test_conservative_with_payout_need_favors_dividends_over_growth():
    weights = main.derive_style_weights("conservative", "primary")

    assert weights["dividend"] > weights["growth"]
    assert weights["defensive"] > weights["growth"]


def test_income_need_wins_even_for_aggressive_profiles():
    weights = main.derive_style_weights("aggressive", "primary")

    assert weights["dividend"] > weights["growth"]
    assert weights["dividend"] >= max(w for s, w in weights.items() if s != "dividend")


def test_conservative_without_income_need_still_avoids_heavy_growth_tilt():
    weights = main.derive_style_weights("conservative", "none")

    assert weights["core"] > weights["growth"]
    assert weights["defensive"] > weights["growth"]


def _stock(style, risk_bucket="medium", dividend_yield=None, size_tier="large"):
    return {
        "style": style,
        "riskBucket": risk_bucket,
        "dividendYield": dividend_yield,
        "sizeTier": size_tier,
    }


def test_dividend_yield_bonus_only_applies_when_payouts_are_needed():
    payer = _stock("dividend", dividend_yield=4.0)

    score_without_need = main.score_stock(payer, "medium", "moderate", "none")
    score_with_need = main.score_stock(payer, "medium", "moderate", "primary")

    # Beyond the style-weight difference, the yield itself must only be
    # rewarded when the user needs payouts.
    style_gap = (
        main.derive_style_weights("moderate", "primary")["dividend"]
        - main.derive_style_weights("moderate", "none")["dividend"]
    )
    assert score_with_need - score_without_need > style_gap


def test_aggressive_no_need_ranks_growth_stock_above_dividend_stock():
    grower = _stock("growth", risk_bucket="high")
    payer = _stock("dividend", risk_bucket="high", dividend_yield=5.0)

    assert main.score_stock(grower, "high", "aggressive", "none") > main.score_stock(
        payer, "high", "aggressive", "none"
    )


def test_max_picks_for_experience():
    assert main.max_picks_for_experience("new") == 4
    assert main.max_picks_for_experience("some") == 6
    assert main.max_picks_for_experience("experienced") == 8


def test_profile_summary_mentions_the_need():
    summary = main.build_profile_summary("aggressive", "long", "none", "experienced")
    assert "compound" in summary

    summary = main.build_profile_summary("conservative", "short", "primary", "new")
    assert "payouts" in summary
    assert "new to investing" in summary


# ---------------------------------------------------------------------------
# Subscription tiers: has_tier
# ---------------------------------------------------------------------------

class _FakeUser:
    def __init__(self, tier):
        self.subscription_tier = tier


def test_has_tier_none_user_is_false_for_every_tier():
    for tier in ("free", "plus", "pro", "ultimate"):
        assert main.has_tier(None, tier) is False


def test_has_tier_free_user_only_meets_free():
    user = _FakeUser("free")
    assert main.has_tier(user, "free") is True
    assert main.has_tier(user, "plus") is False
    assert main.has_tier(user, "pro") is False
    assert main.has_tier(user, "ultimate") is False


def test_has_tier_plus_user_meets_free_and_plus():
    user = _FakeUser("plus")
    assert main.has_tier(user, "plus") is True
    assert main.has_tier(user, "pro") is False


def test_has_tier_pro_user_meets_everything_below_ultimate():
    user = _FakeUser("pro")
    assert main.has_tier(user, "free") is True
    assert main.has_tier(user, "plus") is True
    assert main.has_tier(user, "pro") is True
    assert main.has_tier(user, "ultimate") is False


def test_has_tier_ultimate_user_meets_all_tiers():
    user = _FakeUser("ultimate")
    for tier in ("free", "plus", "pro", "ultimate"):
        assert main.has_tier(user, tier) is True


def test_has_tier_unknown_tier_string_is_treated_as_free():
    user = _FakeUser("premium")  # legacy value that should be migrated away
    assert main.has_tier(user, "free") is True
    assert main.has_tier(user, "plus") is False


# ---------------------------------------------------------------------------
# Portfolios: compute_holdings (average-cost ledger math)
# ---------------------------------------------------------------------------

import pytest


def _buy(symbol, shares, price):
    return {"symbol": symbol, "type": "buy", "shares": shares, "price": price}


def _sell(symbol, shares, price):
    return {"symbol": symbol, "type": "sell", "shares": shares, "price": price}


def test_holdings_single_buy():
    result = main.compute_holdings([_buy("AAPL", 10, 150.0)])

    assert result["holdings"]["AAPL"] == {"shares": 10, "avgCost": 150.0}
    assert result["realizedGainLoss"] == 0.0


def test_holdings_multiple_buys_average_the_cost():
    result = main.compute_holdings([
        _buy("AAPL", 10, 150.0),
        _buy("AAPL", 10, 170.0),
    ])

    assert result["holdings"]["AAPL"]["shares"] == 20
    assert result["holdings"]["AAPL"]["avgCost"] == 160.0


def test_holdings_sell_reduces_shares_and_realizes_gain():
    result = main.compute_holdings([
        _buy("AAPL", 10, 150.0),
        _buy("AAPL", 10, 170.0),
        _sell("AAPL", 5, 180.0),
    ])

    assert result["holdings"]["AAPL"]["shares"] == 15
    # Average cost is unchanged by a sell.
    assert result["holdings"]["AAPL"]["avgCost"] == 160.0
    # Realized: (180 - 160) * 5 = 100
    assert result["realizedGainLoss"] == 100.0


def test_holdings_sell_everything_removes_the_symbol():
    result = main.compute_holdings([
        _buy("AAPL", 10, 150.0),
        _sell("AAPL", 10, 140.0),
    ])

    assert "AAPL" not in result["holdings"]
    assert result["realizedGainLoss"] == -100.0


def test_holdings_sell_everything_survives_float_drift():
    result = main.compute_holdings([
        _buy("AAPL", 0.1, 100.0),
        _buy("AAPL", 0.1, 100.0),
        _buy("AAPL", 0.1, 100.0),
        _sell("AAPL", 0.3, 110.0),
    ])

    assert "AAPL" not in result["holdings"]


def test_holdings_overselling_raises():
    with pytest.raises(ValueError):
        main.compute_holdings([
            _buy("AAPL", 5, 150.0),
            _sell("AAPL", 6, 160.0),
        ])


def test_holdings_symbols_are_independent():
    result = main.compute_holdings([
        _buy("AAPL", 10, 150.0),
        _buy("MSFT", 2, 300.0),
        _sell("AAPL", 10, 155.0),
    ])

    assert "AAPL" not in result["holdings"]
    assert result["holdings"]["MSFT"] == {"shares": 2, "avgCost": 300.0}
    assert result["realizedGainLoss"] == 50.0


# ---------------------------------------------------------------------------
# Money module: compute_money_summary
# ---------------------------------------------------------------------------

def test_money_summary_empty_month_has_zeroed_totals():
    summary = main.compute_money_summary([], {})

    assert summary["totalIncome"] == 0
    assert summary["totalExpenses"] == 0
    assert summary["netCashFlow"] == 0
    assert summary["savingsRate"] == 0.0
    assert all(c["spent"] == 0 for c in summary["categories"])


def test_money_summary_income_only_has_full_savings_rate():
    transactions = [{"type": "income", "category": "Income", "amount": 1000.0}]

    summary = main.compute_money_summary(transactions, {})

    assert summary["totalIncome"] == 1000.0
    assert summary["totalExpenses"] == 0
    assert summary["netCashFlow"] == 1000.0
    assert summary["savingsRate"] == 1.0


def test_money_summary_expense_only_has_negative_cash_flow_and_zero_savings_rate():
    transactions = [{"type": "expense", "category": "Food", "amount": 150.0}]

    summary = main.compute_money_summary(transactions, {})

    assert summary["totalExpenses"] == 150.0
    assert summary["netCashFlow"] == -150.0
    # Savings rate is undefined with no income; treated as 0 rather than dividing by zero.
    assert summary["savingsRate"] == 0.0

    food_category = next(c for c in summary["categories"] if c["category"] == "Food")
    assert food_category["spent"] == 150.0


def test_money_summary_mixed_transactions_with_budgets_per_category():
    transactions = [
        {"type": "income", "category": "Income", "amount": 2000.0},
        {"type": "expense", "category": "Housing", "amount": 800.0},
        {"type": "expense", "category": "Food", "amount": 200.0},
        {"type": "expense", "category": "Food", "amount": 50.0},
    ]
    budgets = {"Housing": 900.0, "Food": 300.0}

    summary = main.compute_money_summary(transactions, budgets)

    assert summary["totalIncome"] == 2000.0
    assert summary["totalExpenses"] == 1050.0
    assert summary["netCashFlow"] == 950.0
    assert summary["savingsRate"] == 0.475

    housing = next(c for c in summary["categories"] if c["category"] == "Housing")
    food = next(c for c in summary["categories"] if c["category"] == "Food")
    entertainment = next(c for c in summary["categories"] if c["category"] == "Entertainment")

    assert housing == {"category": "Housing", "spent": 800.0, "budget": 900.0}
    assert food == {"category": "Food", "spent": 250.0, "budget": 300.0}
    # Untouched categories still appear, with no spend and no budget set.
    assert entertainment == {"category": "Entertainment", "spent": 0.0, "budget": None}


def test_risk_profile_short_horizon_pulls_down_an_otherwise_bold_reaction():
    # buy_more (2) + short horizon (0) = 2 -> moderate, not aggressive --
    # a short time horizon should cap risk even for a bold reaction.
    assert main.determine_risk_profile("buy_more", "short") == "moderate"


# ---------------------------------------------------------------------------
# Recommendation engine: style/risk classification from fundamentals
# ---------------------------------------------------------------------------

def test_classify_style_high_yield_is_dividend():
    info = {"dividendYield": 4.5, "trailingPE": 12, "profitMargins": 0.1}
    assert main.classify_style(info, "Energy") == "dividend"


def test_classify_style_high_revenue_growth_is_growth():
    info = {"dividendYield": None, "revenueGrowth": 0.4, "trailingPE": 40}
    assert main.classify_style(info, "Technology") == "growth"


def test_classify_style_low_pe_profitable_is_value():
    info = {"dividendYield": None, "revenueGrowth": 0.02, "trailingPE": 10, "profitMargins": 0.15}
    assert main.classify_style(info, "Financial Services") == "value"


def test_classify_style_defensive_sector_low_beta():
    info = {"dividendYield": None, "revenueGrowth": None, "trailingPE": None, "beta": 0.6}
    assert main.classify_style(info, "Utilities") == "defensive"


def test_classify_style_falls_back_to_core():
    info = {"dividendYield": None, "revenueGrowth": None, "trailingPE": None, "beta": 1.2}
    assert main.classify_style(info, "Industrials") == "core"


def test_classify_risk_bucket_high_beta_large_cap():
    assert main.classify_risk_bucket({"beta": 2.0}, "large") == "high"


def test_classify_risk_bucket_low_beta_large_cap():
    assert main.classify_risk_bucket({"beta": 0.5}, "large") == "low"


def test_classify_risk_bucket_missing_beta_defaults_medium():
    assert main.classify_risk_bucket({"beta": None}, "large") == "medium"


def test_classify_risk_bucket_mid_tier_bumps_risk_up():
    # A mid-cap company gets bumped up a risk tier vs. the same beta at large-cap,
    # since smaller companies carry idiosyncratic risk beta alone doesn't capture.
    assert main.classify_risk_bucket({"beta": 0.5}, "mid") == "medium"
    assert main.classify_risk_bucket({"beta": 1.0}, "mid") == "high"


# ---------------------------------------------------------------------------
# Recommendation engine: scoring
# ---------------------------------------------------------------------------

def test_score_stock_prefers_matching_risk_bucket():
    growth_stock = {"riskBucket": "high", "style": "growth", "dividendYield": None, "sizeTier": "large"}
    aggressive_score = main.score_stock(growth_stock, "high", "aggressive", "none")
    conservative_score = main.score_stock(growth_stock, "low", "aggressive", "none")
    assert aggressive_score > conservative_score


def test_score_stock_dividend_yield_boosts_payout_need():
    high_yield = {"riskBucket": "low", "style": "dividend", "dividendYield": 4.0, "sizeTier": "large"}
    low_yield = {"riskBucket": "low", "style": "dividend", "dividendYield": 0.5, "sizeTier": "large"}
    assert main.score_stock(high_yield, "low", "conservative", "primary") > main.score_stock(
        low_yield, "low", "conservative", "primary"
    )


def test_score_stock_large_size_tier_beats_identical_mid_candidate():
    large = {"riskBucket": "medium", "style": "core", "dividendYield": None, "sizeTier": "large"}
    mid = {"riskBucket": "medium", "style": "core", "dividendYield": None, "sizeTier": "mid"}
    assert main.score_stock(large, "medium", "moderate", "some") > main.score_stock(
        mid, "medium", "moderate", "some"
    )


def test_score_core_etf_bond_etf_preferred_for_conservative_payout_need():
    bond = {"riskBucket": "low", "category": "bond_etf"}
    broad = {"riskBucket": "medium", "category": "broad_etf"}
    assert main.score_core_etf(bond, "low", "conservative", "primary") > main.score_core_etf(
        broad, "low", "conservative", "primary"
    )


# ---------------------------------------------------------------------------
# Recommendation engine: sector diversification cap
# ---------------------------------------------------------------------------

def test_select_diversified_picks_caps_per_sector():
    candidates = [
        {"symbol": f"TECH{i}", "sector": "Technology", "score": 10 - i}
        for i in range(5)
    ] + [
        {"symbol": "HC1", "sector": "Healthcare", "score": 4},
        {"symbol": "HC2", "sector": "Healthcare", "score": 3},
    ]

    picks = main.select_diversified_picks(candidates, count=4, max_per_sector=2)

    tech_picks = [p for p in picks if p["sector"] == "Technology"]
    assert len(tech_picks) == 2  # capped, even though Technology has the top scores
    assert len(picks) == 4
    # The two highest-scoring Technology picks should be the ones kept.
    assert {p["symbol"] for p in tech_picks} == {"TECH0", "TECH1"}


def test_select_diversified_picks_respects_requested_count():
    candidates = [{"symbol": f"S{i}", "sector": "Energy", "score": i} for i in range(10)]
    picks = main.select_diversified_picks(candidates, count=3, max_per_sector=10)
    assert len(picks) == 3


# ---------------------------------------------------------------------------
# Company name normalization (dual share-class dedup)
# ---------------------------------------------------------------------------

def test_normalize_company_name_strips_suffixes_and_case():
    assert main.normalize_company_name("Apple Inc.") == "apple"
    assert main.normalize_company_name("ALPHABET INC.") == "alphabet"


def test_normalize_company_name_dual_share_classes_match():
    # GOOGL ("Alphabet Inc. Class A") and GOOG ("Alphabet Inc. Class C")
    # must normalize to the same key so dedup collapses them to one pick.
    a = main.normalize_company_name("Alphabet Inc. Class A")
    c = main.normalize_company_name("Alphabet Inc. Class C")
    assert a == c


def test_normalize_company_name_empty_input():
    assert main.normalize_company_name("") == ""
    assert main.normalize_company_name(None) == ""
