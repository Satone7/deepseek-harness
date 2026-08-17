import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'
import type { RouterConfig, RouterPool } from '../src/types.ts'

function configWith(pools: unknown): () => unknown {
  return () => Config({ pools } as never)
}

/** Resolve one candidate whose quotaProbe is the supplied raw value. */
function resolveWithProbe(quotaProbe: unknown) {
  return resolveConfig({
    pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm', quotaProbe: quotaProbe as never }] }],
  })
}

describe('router config schema', () => {
  it('materializes the dormant default and pool defaults', () => {
    const empty = configWith(undefined)() as { pools: unknown[] }
    expect(empty.pools).toEqual([])

    const defaults = Config({
      pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'zhipu', model: 'glm' }] }],
    }) as { pools: Array<{ strategy: string; candidates: Array<{ weight: number }> }> }
    expect(defaults.pools[0]?.strategy).toBe('weighted-random')
    expect(defaults.pools[0]?.candidates[0]?.weight).toBe(1)
  })

  it('rejects an unknown strategy and a non-positive weight', () => {
    expect(configWith([{ id: 'auto', strategy: 'fastest', candidates: [{ id: 'a', provider: 'p', model: 'm' }] }])).toThrow()
    expect(configWith([{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm', weight: 0 }] }])).toThrow()
  })

  it('accepts an empty candidate list at the schema and rejects it in resolution', () => {
    // The item schema has defaults, so schemastery skips the array minimum;
    // `apply` owns this fail-loud check for both Loader and direct callers.
    const empty = configWith([{ id: 'auto', candidates: [] }])() as RouterConfig
    expect(() => resolveConfig(empty)).toThrow(/at least one candidate/)
  })
})

describe('resolveConfig fail-loud relationships', () => {
  it('returns an empty pool list for an omitted pool list', () => {
    expect(resolveConfig({})).toEqual([])
  })

  it('rejects an unknown strategy and a non-positive or fractional weight', () => {
    expect(() => resolveConfig({
      pools: [{ id: 'auto', strategy: 'fastest' as never, candidates: [{ id: 'a', provider: 'p', model: 'm' }] }],
    })).toThrow(/unknown strategy/)
    expect(() => resolveConfig({
      pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm', weight: 0 }] }],
    })).toThrow(/weight must be a positive integer/)
    expect(() => resolveConfig({
      pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm', weight: 1.5 }] }],
    })).toThrow(/weight must be a positive integer/)
  })

  it('rejects duplicate pool ids and duplicate candidate ids', () => {
    const base: Omit<RouterPool, 'id'> = { strategy: 'round-robin', candidates: [{ id: 'a', provider: 'p', model: 'm' }] }
    expect(() => resolveConfig({ pools: [{ id: 'auto', ...base }, { id: 'auto', ...base }] }))
      .toThrow(/duplicate pool id "auto"/)
    expect(() => resolveConfig({
      pools: [{ id: 'auto', candidates: [
        { id: 'a', provider: 'p', model: 'm' },
        { id: 'a', provider: 'q', model: 'n' },
      ] }],
    })).toThrow(/duplicate candidate id "a"/)
  })

  it('rejects empty pool/candidate ids and empty provider/model names', () => {
    const cases: RouterConfig[] = [
      { pools: [{ id: '', candidates: [{ id: 'a', provider: 'p', model: 'm' }] }] },
      { pools: [{ id: 'auto', candidates: [{ id: '', provider: 'p', model: 'm' }] }] },
      { pools: [{ id: 'auto', candidates: [{ id: 'a', provider: '', model: 'm' }] }] },
      { pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: '' }] }] },
    ]
    for (const config of cases) expect(() => resolveConfig(config)).toThrow()
  })

  it('materializes omitted strategy and weight for direct callers', () => {
    const pools = resolveConfig({
      pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm' }] }],
    })
    expect(pools).toEqual([{
      id: 'auto',
      strategy: 'weighted-random',
      candidates: [{ id: 'a', provider: 'p', model: 'm', weight: 1 }],
    }])
  })

  it('materializes quota probe defaults and the credential reference', () => {
    const pools = resolveConfig({
      pools: [{
        id: 'auto',
        candidates: [{
          id: 'a',
          provider: 'p',
          model: 'm',
          quotaProbe: { kind: 'kimi', apiKeyEnv: 'KIMI_API_KEY' },
        }],
      }],
    })
    expect(pools[0]?.candidates[0]?.quotaProbe).toEqual({
      kind: 'kimi',
      apiKeyRef: 'KIMI_API_KEY',
      maxPercentage: 100,
      ttlSeconds: 300,
    })
  })

  it('rejects unknown probe kinds, invalid references, and inapplicable thresholds', () => {
    expect(() => resolveWithProbe({ kind: 'unknown', apiKeyEnv: 'K' })).toThrow(/unknown quotaProbe kind/)
    expect(() => resolveWithProbe({ kind: 'zhipu', apiKeyEnv: '9BAD' })).toThrow(/apiKeyEnv is invalid/)
    expect(() => resolveWithProbe({ kind: 'zhipu', apiKeyEnv: 'K', minBalance: 10 })).toThrow(/only applies to deepseek-balance/)
    expect(() => resolveWithProbe({ kind: 'deepseek-balance', apiKeyEnv: 'K', maxPercentage: 90 })).toThrow(/only applies to percentage probes/)
    expect(() => resolveWithProbe({ kind: 'zhipu', apiKeyEnv: 'K', ttlSeconds: 0 })).toThrow(/positive integer/)
  })

  it('rejects empty probe fields and out-of-range thresholds', () => {
    expect(() => resolveWithProbe({ kind: 'zhipu', apiKeyEnv: '' })).toThrow(/non-empty apiKeyEnv/)
    expect(() => resolveWithProbe({ kind: 'zhipu', apiKeyEnv: 'K', maxPercentage: 101 })).toThrow(/maxPercentage must be/)
    expect(() => resolveWithProbe({ kind: 'zhipu', apiKeyEnv: 'K', maxPercentage: Number.NaN })).toThrow(/maxPercentage must be/)
    expect(() => resolveWithProbe({ kind: 'deepseek-balance', apiKeyEnv: 'K', minBalance: -1 })).toThrow(/minBalance must be/)
    expect(() => resolveWithProbe({ kind: 'deepseek-balance', apiKeyEnv: 'K', minBalance: Number.POSITIVE_INFINITY })).toThrow(/minBalance must be/)
  })

  it('materializes balance-probe defaults', () => {
    const pools = resolveConfig({
      pools: [{
        id: 'auto',
        candidates: [{
          id: 'a',
          provider: 'p',
          model: 'm',
          quotaProbe: { kind: 'deepseek-balance', apiKeyEnv: 'DEEPSEEK_API_KEY' },
        }],
      }],
    })
    expect(pools[0]?.candidates[0]?.quotaProbe).toEqual({
      kind: 'deepseek-balance',
      apiKeyRef: 'DEEPSEEK_API_KEY',
      minBalance: 0,
      ttlSeconds: 300,
    })
  })
})

describe('maxInflight configuration', () => {
  it('materializes an omitted maxInflight as absent', () => {
    const pools = resolveConfig({
      pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm' }] }],
    })
    expect(pools[0]?.candidates[0]).not.toHaveProperty('maxInflight')
  })

  it('materializes a positive maxInflight', () => {
    const pools = resolveConfig({
      pools: [{
        id: 'auto',
        candidates: [{ id: 'a', provider: 'p', model: 'm', maxInflight: 3 }],
      }],
    })
    expect(pools[0]?.candidates[0]?.maxInflight).toBe(3)
  })

  it('rejects non-positive or fractional maxInflight', () => {
    expect(() => resolveConfig({
      pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm', maxInflight: 0 }] }],
    })).toThrow(/maxInflight must be a positive integer/)
    expect(() => resolveConfig({
      pools: [{ id: 'auto', candidates: [{ id: 'a', provider: 'p', model: 'm', maxInflight: 1.5 }] }],
    })).toThrow(/maxInflight must be a positive integer/)
  })

  it('accepts score-weighted as a strategy', () => {
    expect(resolveConfig({
      pools: [{
        id: 'auto',
        strategy: 'score-weighted',
        candidates: [{ id: 'a', provider: 'p', model: 'm' }],
      }],
    })[0]?.strategy).toBe('score-weighted')
  })
})
