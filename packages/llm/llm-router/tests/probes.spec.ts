import { describe, expect, it } from 'vitest'
import { CachedQuotaProbe } from '../src/probe/cache.ts'
import { DeepseekBalanceQuotaProbe, parseDeepseekBalanceResponse } from '../src/probe/deepseek.ts'
import { QuotaProbeError, fetchJson } from '../src/probe/http.ts'
import type { ProbeFetcher } from '../src/probe/http.ts'
import { KimiQuotaProbe, parseKimiQuotaResponse } from '../src/probe/kimi.ts'
import { clampPercentage, earliestResetAt, parseEpochResetTime, parseFiniteNumber } from '../src/probe/parse.ts'
import { ZhipuQuotaProbe, parseZhipuQuotaResponse } from '../src/probe/zhipu.ts'
import type { QuotaProbe, QuotaSnapshot } from '../src/probe/types.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'FAIL',
    headers: { 'content-type': 'application/json' },
  })
}

describe('zhipu quota parser', () => {
  it('keeps only TOKENS_LIMIT entries and uses the maximum percentage', () => {
    const snapshot = parseZhipuQuotaResponse({
      data: {
        limits: [
          { type: 'TIME_LIMIT', percentage: 99 },
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 42, nextResetTime: 1234567890 },
          { type: 'TOKENS_LIMIT', unit: 4, number: 2, percentage: 70, nextResetTime: 2234567890 },
        ],
      },
    })
    expect(snapshot).toMatchObject({
      kind: 'percentage',
      percentage: 70,
      used: 70,
      limit: 100,
      resetAt: 1234567890000,
      windows: [
        { label: '5h', percentage: 42, resetAt: 1234567890000 },
        { label: '2d', percentage: 70, resetAt: 2234567890000 },
      ],
    })
  })

  it('returns zero quota when no TOKENS_LIMIT entry exists', () => {
    expect(parseZhipuQuotaResponse({ data: { limits: [{ type: 'TIME_LIMIT' }] } })).toMatchObject({
      percentage: 0,
      windows: [],
    })
  })

  it('labels week and unknown units and defaults missing window fields', () => {
    const snapshot = parseZhipuQuotaResponse({ data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 10 },
      { type: 'TOKENS_LIMIT', unit: 9, number: 2, percentage: 20 },
      { type: 'TOKENS_LIMIT', percentage: 5 },
    ] } })
    expect(snapshot.windows?.map(window => window.label)).toEqual(['1w', '2u9', '0u0'])
    expect(snapshot.windows?.[2]).not.toHaveProperty('resetAt')
  })

  it('queries the provider endpoint with the raw authorization header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: ProbeFetcher = async (url, init) => {
      calls.push({ url, init: init ?? {} })
      return jsonResponse({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 30 }] } })
    }
    const probe = new ZhipuQuotaProbe(fetcher)
    await expect(probe.query('zhipu-key')).resolves.toMatchObject({ percentage: 30 })
    expect(calls[0]).toMatchObject({ url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit' })
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'zhipu-key' })
  })

  it('rejects malformed response bodies and token entries', () => {
    expect(() => parseZhipuQuotaResponse(null)).toThrow(QuotaProbeError)
    expect(() => parseZhipuQuotaResponse({ data: { limits: 'not-an-array' } })).toThrow(QuotaProbeError)
    expect(() => parseZhipuQuotaResponse({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: '70' }] } }))
      .toThrow(/finite percentage/)
  })
})

describe('kimi quota parser', () => {
  it('parses string quota fields across weekly and rolling windows', () => {
    const snapshot = parseKimiQuotaResponse({
      usage: { limit: '100', used: '30', remaining: '70', resetTime: '2026-08-20T00:00:00Z' },
      limits: [{
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { limit: '100', used: '10', remaining: '90', resetTime: 1700000000 },
      }],
    })
    expect(snapshot).toMatchObject({
      kind: 'percentage',
      used: 30,
      limit: 100,
      percentage: 30,
      resetAt: 1700000000000,
      windows: [
        { label: '5h', percentage: 10, resetAt: 1700000000000 },
        { label: '1w', percentage: 30, resetAt: Date.parse('2026-08-20T00:00:00Z') },
      ],
    })
  })

  it('falls back to limit minus remaining and clamps over-reporting', () => {
    const snapshot = parseKimiQuotaResponse({
      limits: [{ detail: { limit: '50', remaining: '10', used: '120' } }],
    })
    expect(snapshot.windows?.[0]?.percentage).toBe(100)
    const fallback = parseKimiQuotaResponse({
      limits: [{ detail: { limit: '50', remaining: '10' } }],
    })
    expect(fallback.windows?.[0]?.percentage).toBe(80)
    const unused = parseKimiQuotaResponse({
      limits: [{ detail: { limit: '100' } }],
    })
    expect(unused.windows?.[0]?.percentage).toBe(0)
  })

  it('rejects malformed usage and limits fields', () => {
    expect(() => parseKimiQuotaResponse('kimi')).toThrow(QuotaProbeError)
    expect(() => parseKimiQuotaResponse({ usage: 'weekly' })).toThrow(/usage must be an object/)
    expect(() => parseKimiQuotaResponse({ limits: 'rolling' })).toThrow(/limits must be an array/)
  })

  it('labels every window unit and skips malformed rolling entries', () => {
    const snapshot = parseKimiQuotaResponse({
      usage: { limit: 0 },
      limits: [
        'not-an-entry',
        { window: null },
        { window: null, detail: { limit: 100, used: 20 } },
        { window: { duration: 0, timeUnit: 'TIME_UNIT_HOUR' }, detail: { limit: 100, used: 21 } },
        { window: { duration: 2, timeUnit: 'TIME_UNIT_HOUR' }, detail: { limit: 100, used: 22 } },
        { window: { duration: 1, timeUnit: 'TIME_UNIT_DAY' }, detail: { limit: 100, used: 23 } },
        { window: { duration: 90, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: 100, used: 24 } },
        { window: { duration: 45, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: 100, used: 25 } },
        { window: { duration: 2, timeUnit: 'TIME_UNIT_UNKNOWN' }, detail: { limit: 100, used: 26 } },
      ],
    })
    expect(snapshot.windows?.map(window => window.label)).toEqual(['5h', '5h', '2h', '1d', '90m', '45m', '2u', '1w'])
    expect(snapshot.percentage).toBe(26)
    expect(snapshot.used).toBe(0)
    expect(snapshot.limit).toBe(0)
  })

  it('queries the coding-plan endpoint with a bearer key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: ProbeFetcher = async (url, init) => {
      calls.push({ url, init: init ?? {} })
      return jsonResponse({ usage: { limit: '10', used: '4' } })
    }
    const probe = new KimiQuotaProbe(fetcher)
    await expect(probe.query('kimi-key')).resolves.toMatchObject({ percentage: 40, used: 4, limit: 10 })
    expect(calls[0]).toMatchObject({ url: 'https://api.kimi.com/coding/v1/usages' })
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer kimi-key' })
  })
})

describe('deepseek balance parser', () => {
  it('parses the first balance entry', () => {
    expect(parseDeepseekBalanceResponse({
      balance_infos: [{ currency: 'CNY', total_balance: '12.34' }],
    })).toEqual({ kind: 'balance', currency: 'CNY', balance: 12.34 })
  })

  it('defaults to a zero CNY balance when no entry exists', () => {
    expect(parseDeepseekBalanceResponse({ balance_infos: [] }))
      .toEqual({ kind: 'balance', currency: 'CNY', balance: 0 })
    expect(parseDeepseekBalanceResponse({}))
      .toEqual({ kind: 'balance', currency: 'CNY', balance: 0 })
  })

  it('rejects malformed responses and balances', () => {
    expect(() => parseDeepseekBalanceResponse(null)).toThrow(QuotaProbeError)
    expect(() => parseDeepseekBalanceResponse({ balance_infos: 'x' })).toThrow(QuotaProbeError)
    expect(() => parseDeepseekBalanceResponse({ balance_infos: [{ total_balance: 'soon' }] }))
      .toThrow(/finite number or numeric string/)
  })

  it('defaults missing first-entry, currency, and balance fields', () => {
    expect(() => parseDeepseekBalanceResponse({ balance_infos: ['bad'] })).toThrow(QuotaProbeError)
    expect(parseDeepseekBalanceResponse({ balance_infos: [{ currency: '' }] }))
      .toEqual({ kind: 'balance', currency: 'CNY', balance: 0 })
    expect(parseDeepseekBalanceResponse({ balance_infos: [{ currency: 7, total_balance: 0 }] }))
      .toEqual({ kind: 'balance', currency: 'CNY', balance: 0 })
  })

  it('queries the balance endpoint with a bearer key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: ProbeFetcher = async (url, init) => {
      calls.push({ url, init: init ?? {} })
      return jsonResponse({ balance_infos: [{ currency: 'USD', total_balance: '9.5' }] })
    }
    const probe = new DeepseekBalanceQuotaProbe(fetcher)
    await expect(probe.query('deepseek-key')).resolves.toEqual({ kind: 'balance', currency: 'USD', balance: 9.5 })
    expect(calls[0]).toMatchObject({ url: 'https://api.deepseek.com/user/balance' })
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer deepseek-key' })
  })
})

describe('quota probe HTTP transport', () => {
  it('sends the provider headers and returns parsed JSON', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: ProbeFetcher = async (url, init) => {
      calls.push({ url, init: init ?? {} })
      return jsonResponse({ ok: true })
    }
    await expect(fetchJson('https://example.test/quota', { Authorization: 'key' }, fetcher)).resolves.toEqual({ ok: true })
    expect(calls[0]).toMatchObject({ url: 'https://example.test/quota' })
    expect(calls[0]?.init.headers).toMatchObject({ Accept: 'application/json', Authorization: 'key' })
  })

  it('wraps transport and HTTP failures', async () => {
    await expect(fetchJson('https://example.test/quota', {}, async () => {
      throw new Error('offline')
    })).rejects.toMatchObject({ name: 'QuotaProbeError', cause: new Error('offline') })
    await expect(fetchJson('https://example.test/quota', {}, async () => jsonResponse({}, 429)))
      .rejects.toThrow(/HTTP 429/)
  })
})

describe('shared quota scalar parsing', () => {
  it('parses numeric strings and rejects unparseable scalars', () => {
    expect(parseFiniteNumber(1.5)).toBe(1.5)
    expect(parseFiniteNumber('2.5')).toBe(2.5)
    expect(parseFiniteNumber(Number.NaN)).toBeUndefined()
    expect(parseFiniteNumber('')).toBeUndefined()
    expect(parseFiniteNumber('soon')).toBeUndefined()
    expect(parseFiniteNumber(null)).toBeUndefined()
  })

  it('parses epoch seconds, epoch milliseconds, and ISO reset times', () => {
    expect(parseEpochResetTime(1_700_000_000)).toBe(1_700_000_000_000)
    expect(parseEpochResetTime(1_700_000_000_000)).toBe(1_700_000_000_000)
    expect(parseEpochResetTime('2026-08-20T00:00:00Z')).toBe(Date.parse('2026-08-20T00:00:00Z'))
    expect(parseEpochResetTime(Number.NaN)).toBeUndefined()
    expect(parseEpochResetTime(-1)).toBeUndefined()
    expect(parseEpochResetTime('')).toBeUndefined()
    expect(parseEpochResetTime('not-a-date')).toBeUndefined()
  })

  it('clamps percentages and picks the earliest reset', () => {
    expect(clampPercentage(-5)).toBe(0)
    expect(clampPercentage(120)).toBe(100)
    expect(earliestResetAt([])).toBeUndefined()
    expect(earliestResetAt([20, 10])).toBe(10)
  })
})

class ScriptedProbe implements QuotaProbe {
  readonly provider = 'scripted'
  calls = 0
  constructor(private readonly snapshots: readonly (QuotaSnapshot | Error)[]) {}

  query(): Promise<QuotaSnapshot> {
    const next = this.snapshots[this.calls]
    this.calls += 1
    if (next instanceof Error) return Promise.reject(next)
    if (next === undefined) throw new Error('scripted probe exhausted')
    return Promise.resolve(next)
  }
}

const percentage = (value: number): QuotaSnapshot => ({
  kind: 'percentage',
  used: value,
  limit: 100,
  percentage: value,
})

describe('CachedQuotaProbe', () => {
  it('reuses a fresh snapshot and delegates the provider id', async () => {
    const inner = new ScriptedProbe([percentage(10)])
    const cached = new CachedQuotaProbe(inner, 300)
    expect(cached.provider).toBe('scripted')
    await expect(cached.query('key-a')).resolves.toEqual(percentage(10))
    await expect(cached.query('key-a')).resolves.toEqual(percentage(10))
    expect(inner.calls).toBe(1)
  })

  it('refetches after expiry and keeps separate cache entries per key', async () => {
    let now = 0
    const inner = new ScriptedProbe([percentage(10), percentage(20), percentage(30)])
    const cached = new CachedQuotaProbe(inner, 60, { now: () => now })
    await expect(cached.query('key-a')).resolves.toEqual(percentage(10))
    await expect(cached.query('key-b')).resolves.toEqual(percentage(20))
    now = 60_000
    await expect(cached.query('key-a')).resolves.toEqual(percentage(30))
    expect(inner.calls).toBe(3)
  })

  it('returns a stale snapshot when a refresh fails', async () => {
    let now = 0
    const inner = new ScriptedProbe([percentage(10), new Error('provider down')])
    const cached = new CachedQuotaProbe(inner, 60, { now: () => now })
    await expect(cached.query('key')).resolves.toEqual(percentage(10))
    now = 60_000
    await expect(cached.query('key')).resolves.toEqual(percentage(10))
  })

  it('rethrows a refresh failure when no snapshot exists and rejects invalid TTLs', async () => {
    const inner = new ScriptedProbe([new Error('provider down')])
    const cached = new CachedQuotaProbe(inner, 60)
    await expect(cached.query('key')).rejects.toThrow('provider down')
    expect(() => new CachedQuotaProbe(inner, 0)).toThrow(/positive integer/)
    expect(() => new CachedQuotaProbe(inner, 1.5)).toThrow(/positive integer/)
  })
})
