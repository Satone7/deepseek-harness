import { describe, expect, it } from 'vitest'
import type { ResolvedRouterPool } from '../src/config.ts'
import { selectCandidate } from '../src/selector.ts'

function pool(strategy: ResolvedRouterPool['strategy'], weights: number[]): ResolvedRouterPool {
  return {
    id: 'auto',
    strategy,
    candidates: weights.map((weight, index) => ({
      id: `candidate-${index}`,
      provider: `provider-${index}`,
      model: `model-${index}`,
      weight,
    })),
  }
}

describe('weighted-random selection', () => {
  it('samples proportionally to candidate weights', () => {
    const weighted = pool('weighted-random', [1, 2, 1])
    expect(selectCandidate(weighted, 0, () => 0).candidate.id).toBe('candidate-0')
    expect(selectCandidate(weighted, 0, () => 0.2499).candidate.id).toBe('candidate-0')
    expect(selectCandidate(weighted, 0, () => 0.25).candidate.id).toBe('candidate-1')
    expect(selectCandidate(weighted, 0, () => 0.7499).candidate.id).toBe('candidate-1')
    expect(selectCandidate(weighted, 0, () => 0.75).candidate.id).toBe('candidate-2')
  })

  it('returns the last candidate when the random source yields its top value', () => {
    const weighted = pool('weighted-random', [1, 1])
    expect(selectCandidate(weighted, 0, () => 1).candidate.id).toBe('candidate-1')
  })

  it('keeps the round-robin index unchanged', () => {
    const weighted = pool('weighted-random', [1, 1])
    expect(selectCandidate(weighted, 7, () => 0).nextIndex).toBe(7)
  })
})

describe('round-robin selection', () => {
  it('visits candidates in declaration order and wraps', () => {
    const robin = pool('round-robin', [1, 2, 3])
    expect(selectCandidate(robin, 0, () => 1).candidate.id).toBe('candidate-0')
    expect(selectCandidate(robin, 0, () => 1).nextIndex).toBe(1)
    expect(selectCandidate(robin, 1, () => 1).candidate.id).toBe('candidate-1')
    expect(selectCandidate(robin, 2, () => 1).candidate.id).toBe('candidate-2')
    expect(selectCandidate(robin, 2, () => 1).nextIndex).toBe(0)
  })

  it('ignores weights', () => {
    const robin = pool('round-robin', [100, 1])
    expect(selectCandidate(robin, 1, () => 0).candidate.id).toBe('candidate-1')
  })

  it('skips ineligible candidates while keeping the full-pool cursor', () => {
    const robin = pool('round-robin', [1, 1, 1])
    const selection = selectCandidate(robin, 0, () => 0, new Set(['candidate-2']))
    expect(selection).toMatchObject({ candidate: { id: 'candidate-2' }, nextIndex: 0 })
    expect(selectCandidate(robin, 1, () => 0, new Set(['candidate-0'])).candidate.id).toBe('candidate-0')
  })
})

describe('eligible-candidate filtering', () => {
  it('filters weighted selection to the eligible set and rejects an empty set', () => {
    const weighted = pool('weighted-random', [1, 1])
    expect(selectCandidate(weighted, 0, () => 0.9, new Set(['candidate-1'])).candidate.id).toBe('candidate-1')
    expect(() => selectCandidate(weighted, 0, () => 0, new Set())).toThrow(/no eligible candidate/)
  })

  it('rejects an empty round-robin eligible set', () => {
    const robin = pool('round-robin', [1, 1])
    expect(() => selectCandidate(robin, 0, () => 0, new Set())).toThrow(/no eligible candidate/)
  })
})

describe('score-weighted selection', () => {
  it('samples proportionally to weight times score', () => {
    const scored = pool('score-weighted', [1, 1, 1])
    const scores = new Map([['candidate-0', 0.1], ['candidate-1', 0.8], ['candidate-2', 0.1]])
    // total = 1.0; candidate-1 owns 0.8 of the range.
    expect(selectCandidate(scored, 0, () => 0, undefined, scores).candidate.id).toBe('candidate-0')
    expect(selectCandidate(scored, 0, () => 0.09, undefined, scores).candidate.id).toBe('candidate-0')
    expect(selectCandidate(scored, 0, () => 0.1, undefined, scores).candidate.id).toBe('candidate-1')
    expect(selectCandidate(scored, 0, () => 0.89, undefined, scores).candidate.id).toBe('candidate-1')
    expect(selectCandidate(scored, 0, () => 0.91, undefined, scores).candidate.id).toBe('candidate-2')
  })

  it('uses base weights when scores are omitted or incomplete', () => {
    const scored = pool('score-weighted', [1, 2])
    expect(selectCandidate(scored, 0, () => 0.5).candidate.id).toBe('candidate-1')
    expect(selectCandidate(scored, 0, () => 0.5, undefined, new Map([['candidate-0', 0.1]])).candidate.id).toBe('candidate-1')
  })

  it('falls back to static weights when all scores are zero', () => {
    const scored = pool('score-weighted', [1, 2])
    const scores = new Map([['candidate-0', 0], ['candidate-1', 0]])
    expect(selectCandidate(scored, 0, () => 0.5, undefined, scores).candidate.id).toBe('candidate-1')
    expect(selectCandidate(scored, 0, () => 1, undefined, scores).candidate.id).toBe('candidate-1')
  })

  it('ignores scores for weighted-random and round-robin', () => {
    const weighted = pool('weighted-random', [1, 1])
    const scores = new Map([['candidate-0', 0], ['candidate-1', 1]])
    expect(selectCandidate(weighted, 0, () => 0.5, undefined, scores).candidate.id).toBe('candidate-1')

    const robin = pool('round-robin', [1, 1])
    expect(selectCandidate(robin, 0, () => 0, undefined, scores).candidate.id).toBe('candidate-0')
  })
})
