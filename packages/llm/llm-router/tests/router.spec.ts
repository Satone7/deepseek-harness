import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as router from '../src/index.ts'
import type { RouterConfig } from '../src/types.ts'

let context: Context | undefined

class MemoryCredentials extends CredentialProvider {
  private readonly store: Map<string, string>

  constructor(ctx: Context, seed: Record<string, string> = {}) {
    super(ctx)
    this.store = new Map(Object.entries(seed))
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.store.get(ref)
    return Promise.resolve(value === undefined || value.length === 0 ? undefined : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    const configured = (this.store.get(ref)?.length ?? 0) > 0
    return Promise.resolve({ configured, writable: true })
  }

  override set(): Promise<void> {
    return Promise.reject(new Error('read-only memory credentials'))
  }

  override unset(): Promise<void> {
    return Promise.resolve()
  }
}


class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await context?.fiber.dispose()
  context = undefined
})

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: `${options.provider}:${options.model}` }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `${options.provider}:${options.model}` } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(
  config: RouterConfig,
  internals: router.RouterInternals = { random: () => 0 },
  credentialsSeed?: Record<string, string>,
): Promise<{ ctx: Context; adapter: RecordingAdapter; routerFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (credentialsSeed !== undefined) await ctx.plugin(MemoryCredentials, credentialsSeed)
  const routerFiber = await ctx.plugin(Object.assign((inner: Context) => {
    return router.apply(inner, config, internals)
  }, { inject: router.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['zhipu', 'kimi', 'deepseek'], adapter)
  context = ctx
  return { ctx, adapter, routerFiber }
}


/** Adapter that fails each provider with a configured LlmError code. */
class ScriptedFailoverAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly failures: Readonly<Record<string, string>>) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const code = this.failures[options.provider]
    if (code !== undefined) {
      throw new LlmError(`${options.provider} ${code}`, code)
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: `${options.provider}:${options.model}` }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `${options.provider}:${options.model}` } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Adapter that can hold a provider's stream open until released. */
class GatedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly gates = new Map<string, Promise<void>>()
  private readonly release = new Map<string, () => void>()

  gate(provider: string): Promise<void> {
    if (!this.gates.has(provider)) {
      this.gates.set(provider, new Promise<void>((resolve) => {
        this.release.set(provider, resolve)
      }))
    }
    return this.gates.get(provider)!
  }

  open(provider: string): void {
    this.release.get(provider)?.()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    await this.gate(options.provider)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: `${options.provider}:${options.model}` }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `${options.provider}:${options.model}` } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harnessWithAdapter(
  config: RouterConfig,
  adapter: LlmAdapter,
  internals: router.RouterInternals = { random: () => 0 },
): Promise<{ ctx: Context; adapter: LlmAdapter; routerFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const routerFiber = await ctx.plugin(Object.assign((inner: Context) => {
    return router.apply(inner, config, internals)
  }, { inject: router.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['zhipu', 'kimi', 'deepseek'], adapter)
  context = ctx
  return { ctx, adapter, routerFiber }
}

function virtualPool(strategy: 'weighted-random' | 'round-robin' | 'score-weighted'): RouterConfig {
  return {
    pools: [{
      id: 'auto-code',
      strategy,
      candidates: [
        { id: 'zhipu', provider: 'zhipu', model: 'glm', weight: 1 },
        { id: 'kimi', provider: 'kimi', model: 'kimi', weight: 1 },
      ],
    }],
  }
}

function zhipuBody(percentage: number): unknown {
  return { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage }] } }
}

function quotaPool(maxPercentage = 90): RouterConfig {
  return {
    pools: [{
      id: 'auto-code',
      candidates: [
        {
          id: 'zhipu',
          provider: 'zhipu',
          model: 'glm',
          quotaProbe: { kind: 'zhipu', apiKeyEnv: 'ZHIPU_API_KEY', maxPercentage },
        },
        { id: 'kimi', provider: 'kimi', model: 'kimi' },
      ],
    }],
  }
}

/** One candidate pool used to assert the all-excluded request error. */
function exhaustedPool(maxPercentage = 90): RouterConfig {
  return {
    pools: [{
      id: 'auto-code',
      candidates: [{
        id: 'zhipu',
        provider: 'zhipu',
        model: 'glm',
        quotaProbe: { kind: 'zhipu', apiKeyEnv: 'ZHIPU_API_KEY', maxPercentage },
      }],
    }],
  }
}

function zhipuFetcher(percentage: number, status = 200): {
  fetcher: NonNullable<router.RouterInternals['fetch']>
  calls: Array<{ url: string; init: RequestInit }>
} {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher: NonNullable<router.RouterInternals['fetch']> = async (url, init) => {
    calls.push({ url, init: init ?? {} })
    return new Response(JSON.stringify(status === 200 ? zhipuBody(percentage) : {}), {
      status,
      statusText: status === 200 ? 'OK' : 'FAIL',
    })
  }
  return { fetcher, calls }
}

function turnError(agent: Agent): { message: string; code: string } | undefined {
  const end = agent.session.events.findLast(event => event.type === 'turn/end')
  if (end?.type !== 'turn/end' || end.data.reason.kind !== 'error') return undefined
  return end.data.reason.error
}

function drive(ctx: Context, provider: string, model: string, maxTokens?: number): Promise<Agent> {
  const agent = ctx.agentLoop.create(SessionId(`${provider}-${model}-${maxTokens ?? 'default'}`), {
    provider,
    model,
    ...maxTokens === undefined ? {} : { maxTokens },
  })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'route me' }],
    source: { kind: 'user' },
  }))
  return agent.whenIdle().then(() => agent)
}

describe('llm-router on the agent loop', () => {
  it('routes a virtual provider through weighted-random and keeps maxTokens', async () => {
    const { ctx, adapter } = await harness(virtualPool('weighted-random'), { random: () => 0 })

    await drive(ctx, 'auto-code', 'anything', 128)

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]).toMatchObject({ provider: 'zhipu', model: 'glm', maxTokens: 128 })
  })

  it('routes a virtual model and replaces both provider and model', async () => {
    const { ctx, adapter } = await harness(virtualPool('weighted-random'), { random: () => 0.5 })

    await drive(ctx, 'zhipu', 'auto-code')

    expect(adapter.requests[0]).toMatchObject({ provider: 'kimi', model: 'kimi' })
  })

  it('delegates requests that name no pool', async () => {
    const { ctx, adapter } = await harness(virtualPool('weighted-random'))

    await drive(ctx, 'zhipu', 'glm')

    expect(adapter.requests[0]).toMatchObject({ provider: 'zhipu', model: 'glm' })
  })

  it('round-robins across new virtual requests', async () => {
    const { ctx, adapter } = await harness(virtualPool('round-robin'))

    await drive(ctx, 'auto-code', 'one')
    await drive(ctx, 'auto-code', 'two')
    await drive(ctx, 'auto-code', 'three')

    expect(adapter.requests.map(request => [request.provider, request.model])).toEqual([
      ['zhipu', 'glm'],
      ['kimi', 'kimi'],
      ['zhipu', 'glm'],
    ])
  })
})

describe('llm-router quota filtering', () => {
  it('excludes a candidate whose quota percentage reaches the configured maximum', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'zhipu-key')
    const { fetcher, calls } = zhipuFetcher(95)
    const { ctx, adapter } = await harness(quotaPool(90), { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'kimi', model: 'kimi' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'zhipu-key' })
  })

  it('reuses the cached snapshot for later virtual requests', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'zhipu-key')
    const { fetcher, calls } = zhipuFetcher(10)
    const { ctx, adapter } = await harness(quotaPool(90), { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')
    await drive(ctx, 'auto-code', 'two')

    expect(adapter.requests.map(request => request.provider)).toEqual(['zhipu', 'zhipu'])
    expect(calls).toHaveLength(1)
  })

  it('excludes a candidate whose probe credential is missing', async () => {
    const { fetcher, calls } = zhipuFetcher(10)
    const { ctx, adapter } = await harness(quotaPool(90), { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'kimi', model: 'kimi' })
    expect(calls).toHaveLength(0)
  })

  it('excludes a candidate whose probe fails without a cached snapshot', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'zhipu-key')
    const { fetcher, calls } = zhipuFetcher(10, 500)
    const { ctx, adapter } = await harness(quotaPool(90), { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'kimi', model: 'kimi' })
    expect(calls).toHaveLength(1)
  })

  it('routes around an exhausted Kimi candidate', async () => {
    vi.stubEnv('KIMI_API_KEY', 'kimi-key')
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: NonNullable<router.RouterInternals['fetch']> = async (url, init) => {
      calls.push({ url, init: init ?? {} })
      return new Response(JSON.stringify({ usage: { limit: '100', used: '95' } }), { status: 200 })
    }
    const config: RouterConfig = {
      pools: [{
        id: 'auto-code',
        candidates: [
          {
            id: 'kimi',
            provider: 'kimi',
            model: 'kimi',
            quotaProbe: { kind: 'kimi', apiKeyEnv: 'KIMI_API_KEY', maxPercentage: 90 },
          },
          { id: 'zhipu', provider: 'zhipu', model: 'glm' },
        ],
      }],
    }
    const { ctx, adapter } = await harness(config, { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'zhipu', model: 'glm' })
    expect(calls[0]?.url).toBe('https://api.kimi.com/coding/v1/usages')
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer kimi-key' })
  })

  it('routes a DeepSeek candidate when its balance exceeds the configured minimum', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-key')
    const fetcher: NonNullable<router.RouterInternals['fetch']> = async () =>
      new Response(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '12' }] }), { status: 200 })
    const config: RouterConfig = {
      pools: [{
        id: 'auto-code',
        candidates: [
          {
            id: 'deepseek',
            provider: 'deepseek',
            model: 'deepseek',
            quotaProbe: { kind: 'deepseek-balance', apiKeyEnv: 'DEEPSEEK_API_KEY', minBalance: 10 },
          },
          { id: 'zhipu', provider: 'zhipu', model: 'glm' },
        ],
      }],
    }
    const { ctx, adapter } = await harness(config, { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek' })
  })

  it('routes around a DeepSeek candidate whose balance is too low', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-key')
    const fetcher: NonNullable<router.RouterInternals['fetch']> = async () =>
      new Response(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '9' }] }), { status: 200 })
    const config: RouterConfig = {
      pools: [{
        id: 'auto-code',
        candidates: [
          {
            id: 'deepseek',
            provider: 'deepseek',
            model: 'deepseek',
            quotaProbe: { kind: 'deepseek-balance', apiKeyEnv: 'DEEPSEEK_API_KEY', minBalance: 10 },
          },
          { id: 'zhipu', provider: 'zhipu', model: 'glm' },
        ],
      }],
    }
    const { ctx, adapter } = await harness(config, { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'zhipu', model: 'glm' })
  })

  it('resolves probe credentials through the credentials seam', async () => {
    const { fetcher, calls } = zhipuFetcher(10)
    const { ctx, adapter } = await harness(quotaPool(90), { random: () => 0, fetch: fetcher }, { ZHIPU_API_KEY: 'from-seam' })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'zhipu', model: 'glm' })
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'from-seam' })
  })

  it('fails the request with QUOTA when every candidate is excluded', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'zhipu-key')
    const { fetcher } = zhipuFetcher(95)
    const { ctx, adapter } = await harness(exhaustedPool(90), { random: () => 0, fetch: fetcher })

    const agent = await drive(ctx, 'auto-code', 'one')

    expect(turnError(agent)).toEqual({
      message: 'llm-router: pool "auto-code" has no candidate with usable quota',
      code: QUOTA_EXCEEDED_CODE,
    })
    expect(adapter.requests).toHaveLength(0)
  })
})


describe('llm-router M2 failover and load balancing', () => {
  it('fails over to another candidate after the routed provider hits QUOTA', async () => {
    const adapter = new ScriptedFailoverAdapter({ zhipu: 'QUOTA' })
    const { ctx } = await harnessWithAdapter(virtualPool('weighted-random'), adapter, { random: () => 0 })

    const agent = await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests.map(request => request.provider)).toEqual(['zhipu', 'kimi'])
    expect(turnError(agent)).toBeUndefined()
  })

  it('keeps the original error when every candidate is unavailable after failover', async () => {
    const adapter = new ScriptedFailoverAdapter({ zhipu: 'QUOTA', kimi: 'QUOTA' })
    const { ctx } = await harnessWithAdapter(virtualPool('weighted-random'), adapter, { random: () => 0 })

    const agent = await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests.map(request => request.provider)).toEqual(['zhipu', 'kimi'])
    expect(turnError(agent)).toEqual({
      message: 'kimi QUOTA',
      code: QUOTA_EXCEEDED_CODE,
    })
  })

  it('does not intercept errors from an explicit provider that was never routed', async () => {
    const adapter = new ScriptedFailoverAdapter({ zhipu: 'QUOTA' })
    const { ctx } = await harnessWithAdapter(virtualPool('weighted-random'), adapter, { random: () => 0 })

    const agent = await drive(ctx, 'zhipu', 'glm')

    expect(adapter.requests.map(request => request.provider)).toEqual(['zhipu'])
    expect(turnError(agent)).toEqual({
      message: 'zhipu QUOTA',
      code: QUOTA_EXCEEDED_CODE,
    })
  })

  it('routes a second concurrent request to a different provider when the first is at maxInflight', async () => {
    const config: RouterConfig = {
      pools: [{
        id: 'auto-code',
        strategy: 'weighted-random',
        candidates: [
          { id: 'zhipu', provider: 'zhipu', model: 'glm', maxInflight: 1 },
          { id: 'kimi', provider: 'kimi', model: 'kimi', maxInflight: 1 },
        ],
      }],
    }
    const adapter = new GatedAdapter()
    const { ctx } = await harnessWithAdapter(config, adapter, { random: () => 0 })

    const first = drive(ctx, 'auto-code', 'one')
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    expect(adapter.requests[0]?.provider).toBe('zhipu')

    const second = drive(ctx, 'auto-code', 'two')
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    expect(adapter.requests[1]?.provider).toBe('kimi')

    adapter.open('kimi')
    adapter.open('zhipu')
    await Promise.all([first, second])
  })

  it('supports score-weighted selection', async () => {
    const { ctx, adapter } = await harness(virtualPool('score-weighted'), { random: () => 0.9 })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'kimi', model: 'kimi' })
  })

  it('accepts runtime tuning hooks', async () => {
    const { ctx, adapter } = await harness(virtualPool('weighted-random'), {
      random: () => 0,
      now: () => 0,
      quotaCooldownMs: 1,
      rateLimitCooldownMs: 2,
      circuitFailureThreshold: 2,
      circuitCooldownMs: 3,
    })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests).toHaveLength(1)
  })
})

describe('llm-router M2 edge coverage', () => {
  it('routes with default internals when no hooks are injected', async () => {
    const { ctx, adapter } = await harness(virtualPool('weighted-random'), {})

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests).toHaveLength(1)
  })

  it('ignores assistant messages from unmanaged routes', async () => {
    const { ctx, adapter } = await harness(virtualPool('weighted-random'))

    await drive(ctx, 'zhipu', 'custom')

    expect(adapter.requests[0]).toMatchObject({ provider: 'zhipu', model: 'custom' })
  })

  it('score-weighted skips ineligible candidates when building scores', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'zhipu-key')
    const { fetcher } = zhipuFetcher(95)
    const config: RouterConfig = {
      pools: [{
        id: 'auto-code',
        strategy: 'score-weighted',
        candidates: [
          {
            id: 'zhipu',
            provider: 'zhipu',
            model: 'glm',
            quotaProbe: { kind: 'zhipu', apiKeyEnv: 'ZHIPU_API_KEY', maxPercentage: 90 },
          },
          { id: 'kimi', provider: 'kimi', model: 'kimi' },
        ],
      }],
    }
    const { ctx, adapter } = await harness(config, { random: () => 0, fetch: fetcher })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]).toMatchObject({ provider: 'kimi', model: 'kimi' })
  })

  it('accepts runtime tuning hooks', async () => {
    const { ctx, adapter } = await harness(virtualPool('weighted-random'), {
      random: () => 0,
      now: () => 0,
      quotaCooldownMs: 1,
      rateLimitCooldownMs: 2,
      circuitFailureThreshold: 2,
      circuitCooldownMs: 3,
    })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests).toHaveLength(1)
  })
})

describe('llm-router settings namespace', () => {
  it('registers a restart-applies settings namespace when settings is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(Object.assign((inner: Context) => {
      return router.apply(inner, virtualPool('weighted-random'), {})
    }, { inject: router.inject }))

    const namespaces = ctx.settings.describe().map(entry => String(entry.ns))
    expect(namespaces).toContain('llm-router')
    const descriptor = ctx.settings.describe().find(entry => String(entry.ns) === 'llm-router')
    expect(descriptor?.applies).toBe('restart')
    await ctx.fiber.dispose()
  })
})
