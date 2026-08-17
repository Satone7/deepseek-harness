/**
 * Lenient JSON scalar parsing shared by provider quota parsers. Provider APIs
 * return quota numbers as strings or numbers, so each parser accepts both;
 * malformed values become `undefined` and the owning parser decides whether
 * that is absence or an invalid response.
 * @module dsh-llm-router/probe/parse
 */

/** Whether a parsed JSON value is a non-null object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Parse a string-or-number JSON value into a finite number.
 * @param value - provider-supplied scalar.
 * @returns the finite numeric value, or `undefined` when absent or unparseable.
 */
export function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Parse a reset time from an epoch-seconds number, epoch-milliseconds number,
 * or ISO string.
 * @param value - provider-supplied reset time.
 * @returns epoch milliseconds, or `undefined` when absent or unparseable.
 */
export function parseEpochResetTime(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Clamp one computed usage percentage into the 0..100 availability range.
 * @param percentage - raw percentage, which providers may over-report.
 * @returns the clamped percentage.
 */
export function clampPercentage(percentage: number): number {
  return Math.min(100, Math.max(0, percentage))
}

/**
 * Pick the earliest positive reset time from parsed windows.
 * @param values - parsed reset times, with absent values omitted by the caller.
 * @returns the earliest timestamp, or `undefined` for an empty list.
 */
export function earliestResetAt(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return Math.min(...values)
}
