/**
 * Public configuration types for the virtual-provider LLM router.
 * @module @deepseek-ai/dsh-llm-router/types
 */

/** Selection strategy supported by the router. */
export type RouterStrategy = 'weighted-random' | 'round-robin' | 'score-weighted'

/** Built-in quota probe kinds. */
export type QuotaProbeKind = 'zhipu' | 'kimi' | 'deepseek-balance'

/**
 * Per-candidate quota probe. A percentage probe excludes the candidate when
 * any provider window reaches `maxPercentage`; a balance probe excludes it
 * when the balance is not strictly above `minBalance`.
 */
export interface QuotaProbeConfig {
  /** Built-in probe implementation. */
  kind: QuotaProbeKind
  /**
   * Credential reference resolved per request through `ctx.credentials`, with
   * the launch-environment snapshot as the fallback when that seam is absent.
   */
  apiKeyEnv: string
  /** Maximum accepted quota percentage for percentage probes (default 100). */
  maxPercentage?: number
  /** Minimum required balance for deepseek-balance probes (default 0). */
  minBalance?: number
  /** Fresh-result cache lifetime in seconds (default 300). */
  ttlSeconds?: number
}

/** One real provider/model route inside a routing pool. */
export interface RouterCandidate {
  /** Pool-unique candidate identity used in diagnostics and runtime state. */
  id: string
  /** Real provider route selected for this candidate. */
  provider: string
  /** Real model id selected for this candidate. */
  model: string
  /**
   * Relative weight for `weighted-random` pools (default 1). Round-robin
   * ignores weights and visits every candidate once per cycle; `score-weighted`
   * multiplies this base weight by the live availability/load/stability score.
   */
  weight?: number
  /**
   * Maximum concurrent in-flight requests allowed for this candidate. Omitted
   * means no inflight cap; when set, a candidate whose current inflight count
   * is at or above this value is excluded from selection.
   */
  maxInflight?: number
  /**
   * Optional quota gate queried before selection. Candidates without a probe
   * remain eligible without a quota check.
   */
  quotaProbe?: QuotaProbeConfig
}

/** One virtual route mapped to a set of real candidates. */
export interface RouterPool {
  /**
   * Virtual route identity. A request whose `provider` or `model` equals this
   * id is routed; a provider match wins when both fields match different pools.
   */
  id: string
  /** Selection strategy; defaults to `weighted-random`. */
  strategy?: RouterStrategy
  /** Real routes selected for requests that enter this pool. */
  candidates: RouterCandidate[]
}

/** Plugin configuration. */
export interface RouterConfig {
  /** Routing pools; omitted or empty leaves every request untouched. */
  pools?: RouterPool[]
}
