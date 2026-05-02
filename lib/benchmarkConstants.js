/**
 * Single SMB-style benchmark effective rate (illustrative, not a live market quote).
 * Keep in sync with python/statement_engine.py (BENCHMARK_EFFECTIVE_RATE_PCT).
 */
export const BENCHMARK_EFFECTIVE_RATE_PCT = 2.1;

/** @deprecated use BENCHMARK_EFFECTIVE_RATE_PCT */
export const PANEL_EFFECTIVE_RATE_PCT = BENCHMARK_EFFECTIVE_RATE_PCT;

export const FEE_SPLIT_SHARES = {
  interchange: 0.65,
  scheme: 0.1,
  get processor() {
    return Math.max(0, 1 - this.interchange - this.scheme);
  },
};

export const GST_RATE_BY_CURRENCY = {
  USD: 0,
  CAD: 5,
  GBP: 20,
  EUR: 21,
  INR: 18,
  AUD: 10,
  NZD: 15,
  SGD: 9,
};
