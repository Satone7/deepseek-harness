import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LlmRuntime, { createUserMessage, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as router from '../src/index.ts'
import type { RouterConfig } from '../src/types.ts'
import { stateKey } from '../src/state.ts'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'

let contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(contexts.map(context => context.fiber.dispose()))
  contexts = []
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

function virtualPool(): RouterConfig {
  return {
    pools: [{
      id: 'auto-code',
      strategy: 'weighted-random',
      candidates: [
        { id: 'zhipu', provider: 'zhipu', model: 'glm', weight: 1 },
        { id: 'kimi', provider: 'kimi', model: 'kimi', weight: 1 },
      ],
    }],
  }
}

async function harnessWithStorage(
  adapter: LlmAdapter,
  pool: MemoryMediaPool,
  internals: router.RouterInternals = { random: () => 0 },
): Promise<{ ctx: Context; adapter: LlmAdapter; routerFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  const backend = new MemoryStorageBackend(pool)
  ctx.storage.backend.register('memory', backend)
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const routerFiber = await ctx.plugin(Object.assign((inner: Context) => {
    return router.apply(inner, virtualPool(), internals)
  }, { inject: router.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['zhipu', 'kimi'], adapter)
  contexts.push(ctx)
  return { ctx, adapter, routerFiber }
}

async function harnessWithoutStorage(
  adapter: LlmAdapter,
  storageDomain: unknown,
  internals: router.RouterInternals = { random: () => 0 },
): Promise<{ ctx: Context; adapter: LlmAdapter; routerFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.provide('storageDomain', storageDomain as never)
  const routerFiber = await ctx.plugin(Object.assign((inner: Context) => {
    return router.apply(inner, virtualPool(), internals)
  }, { inject: router.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['zhipu', 'kimi'], adapter)
  contexts.push(ctx)
  return { ctx, adapter, routerFiber }
}

function drive(ctx: Context, provider: string, model: string): Promise<Agent> {
  const agent = ctx.agentLoop.create(SessionId(`${provider}-${model}-${Math.random()}`), {
    provider,
    model,
  })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'route me' }],
    source: { kind: 'user' },
  }))
  return agent.whenIdle().then(() => agent)
}

function readState(pool: MemoryMediaPool, candidateId: string): Record<string, unknown> | undefined {
  const medium = pool.media.get('llm_router')
  const records = medium?.tables.get('states')
  return records?.get(stateKey('auto-code', candidateId)) as Record<string, unknown> | undefined
}

describe('llm-router M3 persistence', () => {
  it('persists failover cooldown and restores it on restart', async () => {
    const pool = new MemoryMediaPool()
    const adapter = new ScriptedFailoverAdapter({ zhipu: 'QUOTA' })
    const first = await harnessWithStorage(adapter, pool, { random: () => 0 })

    await drive(first.ctx, 'auto-code', 'one')

    expect(adapter.requests.map(request => request.provider)).toEqual(['zhipu', 'kimi'])
    const persisted = readState(pool, 'zhipu')!
    expect(persisted.inflight).toBe(0)
    expect(persisted.circuit).toBe('closed')
    expect(typeof persisted.cooldownUntil).toBe('number')
    await first.ctx.fiber.dispose()

    const secondAdapter = new RecordingAdapter()
    const second = await harnessWithStorage(secondAdapter, pool, { random: () => 0 })
    await drive(second.ctx, 'auto-code', 'two')

    expect(secondAdapter.requests.map(request => request.provider)).toEqual(['kimi'])
    await second.ctx.fiber.dispose()
  })

  it('persists inflight before completion and clears it after success', async () => {
    const pool = new MemoryMediaPool()
    const adapter = new GatedAdapter()
    const { ctx } = await harnessWithStorage(adapter, pool, { random: () => 0 })

    const first = drive(ctx, 'auto-code', 'one')
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    expect(readState(pool, 'zhipu')?.inflight).toBe(1)

    adapter.open('zhipu')
    await first
    await vi.waitFor(() => { expect(readState(pool, 'zhipu')?.inflight).toBe(0) })
  })

  it('loads persisted circuit/cooldown and ignores unknown or malformed rows', async () => {
    const pool = new MemoryMediaPool()
    // Seed before the router opens the domain.
    const medium = {
      tables: new Map<string, Map<string, unknown>>([
        ['states', new Map<string, unknown>([
          [stateKey('auto-code', 'zhipu'), {
            inflight: 0,
            consecutiveFailures: 2,
            circuit: 'open',
            cooldownUntil: 9_999_999_999_999,
            lastError: 'stale outage',
          }],
          [stateKey('unknown-pool', 'unknown'), {
            inflight: 0,
            consecutiveFailures: 0,
            circuit: 'closed',
            cooldownUntil: null,
            lastError: null,
          }],
          ['not-json', {
            inflight: 0,
            consecutiveFailures: 0,
            circuit: 'closed',
            cooldownUntil: null,
            lastError: null,
          }],
        ])],
      ]),
      global: null,
    }
    pool.media.set('llm_router', medium)
    pool.versions.set('llm_router', 1)

    const adapter = new RecordingAdapter()
    const { ctx } = await harnessWithStorage(adapter, pool, { random: () => 0 })
    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests.map(request => request.provider)).toEqual(['kimi'])
  })

  it('persists a half-open transition when an open circuit cooldown expires', async () => {
    const pool = new MemoryMediaPool()
    pool.media.set('llm_router', {
      tables: new Map<string, Map<string, unknown>>([
        ['states', new Map<string, unknown>([
          [stateKey('auto-code', 'zhipu'), {
            inflight: 0,
            consecutiveFailures: 3,
            circuit: 'open',
            cooldownUntil: 0,
            lastError: 'old outage',
          }],
        ])],
      ]),
      global: null,
    })
    pool.versions.set('llm_router', 1)

    const adapter = new GatedAdapter()
    const { ctx } = await harnessWithStorage(adapter, pool, { random: () => 0 })
    const first = drive(ctx, 'auto-code', 'one')
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    expect(adapter.requests[0]?.provider).toBe('zhipu')
    expect(readState(pool, 'zhipu')?.circuit).toBe('half-open')

    adapter.open('zhipu')
    await first
  })

  it('continues routing when a state write fails', async () => {
    const pool = new MemoryMediaPool()
    pool.failNextWrites = 1
    const adapter = new RecordingAdapter()
    const { ctx } = await harnessWithStorage(adapter, pool, { random: () => 0 })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]?.provider).toBe('zhipu')
  })

  it('continues in-memory when the storage domain cannot be opened', async () => {
    const adapter = new RecordingAdapter()
    const { ctx } = await harnessWithoutStorage(adapter, {
      open: async () => { throw new Error('no backend') },
    }, { random: () => 0 })

    await drive(ctx, 'auto-code', 'one')

    expect(adapter.requests[0]?.provider).toBe('zhipu')
  })
})
