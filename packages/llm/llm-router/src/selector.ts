/**
 * Pure candidate selection for the router. State lives in the caller; these
 * functions only compute one selection and the next round-robin index. The
 * optional eligible-id set is how quota/runtime filtering removes candidates
 * without losing the full-pool round-robin cursor.
 * @module dsh-llm-router/selector
 */

import type { ResolvedRouterCandidate, ResolvedRouterPool } from './config.ts'

/** One selection and the round-robin index for the next selection. */
export interface SelectionResult {
  /** Candidate chosen for this request. */
  candidate: ResolvedRouterCandidate
  /** Next round-robin index; unchanged for weighted strategies. */
  nextIndex: number
}

/** Candidate list for weighted selection, after quota/runtime filtering. */
function weightedCandidates(
  pool: ResolvedRouterPool,
  eligibleIds: ReadonlySet<string> | undefined,
): readonly ResolvedRouterCandidate[] {
  return eligibleIds === undefined
    ? pool.candidates
    : pool.candidates.filter(candidate => eligibleIds.has(candidate.id))
}

/** Static or score-multiplied weight for one candidate. */
function candidateWeight(
  candidate: ResolvedRouterCandidate,
  scores: ReadonlyMap<string, number> | undefined,
): number {
  if (scores === undefined) return candidate.weight
  const score = scores.get(candidate.id)
  if (score === undefined) return candidate.weight
  return Math.max(0, candidate.weight * score)
}

/**
 * Pick one candidate from a resolved pool.
 * @param pool - resolved pool; its candidate list is known non-empty.
 * @param index - current round-robin index (0 when unused).
 * @param random - random source in the inclusive zero-to-one range; weighted
 *   selection samples `random() * totalWeight`.
 * @param eligibleIds - candidate ids that passed quota/runtime filtering; omit
 *   to consider the complete pool.
 * @param scores - live 0..1 scores for `score-weighted` pools; when omitted or
 *   missing for a candidate, the base `weight` is used.
 * @returns the selected candidate and the next round-robin index.
 */
export function selectCandidate(
  pool: ResolvedRouterPool,
  index: number,
  random: () => number,
  eligibleIds?: ReadonlySet<string>,
  scores?: ReadonlyMap<string, number>,
): SelectionResult {
  const length = pool.candidates.length
  if (pool.strategy === 'round-robin') {
    const safeIndex = ((index % length) + length) % length
    for (let offset = 0; offset < length; offset += 1) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the modulo loop bound stays inside the candidate list.
      const candidate = pool.candidates[(safeIndex + offset) % length]!
      if (eligibleIds === undefined || eligibleIds.has(candidate.id)) {
        return { candidate, nextIndex: (safeIndex + offset + 1) % length }
      }
    }
    throw new Error(`llm-router: pool "${pool.id}" has no eligible candidate`)
  }

  const candidates = weightedCandidates(pool, eligibleIds)
  if (candidates.length === 0) {
    throw new Error(`llm-router: pool "${pool.id}" has no eligible candidate`)
  }
  const useScores = pool.strategy === 'score-weighted' && scores !== undefined
  const totalWeight = candidates.reduce(
    (sum, entry) => sum + candidateWeight(entry, useScores ? scores : undefined),
    0,
  )
  if (totalWeight <= 0) {
    // Defensive fallback: an eligible candidate should always have a positive
    // score, but if a custom score map is all zero we still need a selection.
    return weightedFallback(candidates, index, random)
  }
  let target = random() * totalWeight
  for (const entry of candidates) {
    target -= candidateWeight(entry, useScores ? scores : undefined)
    if (target < 0) return { candidate: entry, nextIndex: index }
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the candidate list is known non-empty.
  const last = candidates[candidates.length - 1]!
  return { candidate: last, nextIndex: index }
}

/** Uniform/static fallback used when a score-weighted pool has zero total. */
function weightedFallback(
  candidates: readonly ResolvedRouterCandidate[],
  index: number,
  random: () => number,
): SelectionResult {
  const totalWeight = candidates.reduce((sum, entry) => sum + entry.weight, 0)
  let target = random() * totalWeight
  for (const entry of candidates) {
    target -= entry.weight
    if (target < 0) return { candidate: entry, nextIndex: index }
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the candidate list is known non-empty.
  const last = candidates[candidates.length - 1]!
  return { candidate: last, nextIndex: index }
}
