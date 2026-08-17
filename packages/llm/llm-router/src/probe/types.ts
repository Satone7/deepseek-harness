/**
 * Provider quota snapshot and probe interfaces shared by every built-in
 * adapter. One snapshot describes either a percentage quota (with per-window
 * detail) or an account balance; availability decisions compare those values
 * against the candidate's configured thresholds.
 * @module dsh-llm-router/probe/types
 */

/** One provider quota window inside a percentage snapshot. */
export interface QuotaWindow {
  /** Human-readable window label, such as `5h` or `1w`. */
  label: string
  /** Used percentage from 0 through 100. */
  percentage: number
  /** Next reset time as epoch milliseconds, when the provider reports one. */
  resetAt?: number
}

/** Percentage quota snapshot. */
export interface PercentageQuotaSnapshot {
  kind: 'percentage'
  /** Used quota in provider units, when reported; otherwise normalized percentage. */
  used: number
  /** Quota limit in provider units, when reported; otherwise 100. */
  limit: number
  /** Highest used percentage across all reported windows, from 0 through 100. */
  percentage: number
  /** Earliest positive window reset time, when any window reports one. */
  resetAt?: number
  /** Per-window detail, when the provider reports multiple windows. */
  windows?: QuotaWindow[]
}

/** Account-balance quota snapshot. */
export interface BalanceQuotaSnapshot {
  kind: 'balance'
  /** Balance currency code, such as `CNY`. */
  currency: string
  /** Current total balance. */
  balance: number
}

/** Result of one quota probe query. */
export type QuotaSnapshot = PercentageQuotaSnapshot | BalanceQuotaSnapshot

/** One provider quota API implementation. */
export interface QuotaProbe {
  /** Provider route this probe serves; used in cache keys and diagnostics. */
  readonly provider: string
  /**
   * Query the provider's current quota.
   * @param apiKey - credential value used for provider authentication.
   * @returns the parsed quota snapshot.
   */
  query(apiKey: string): Promise<QuotaSnapshot>
}
