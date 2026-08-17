/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-router`.
 * @module @deepseek-ai/dsh-llm-router/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-router'

/** Cordis companion plugin name. */
export const name = 'llm-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package writes no independent session event. Its
 * durable runtime state (cooldown, circuit, inflight, last error) is written
 * through the storage-domain form when mounted, and request routing is still a
 * request-header proposal logged and validated by the agent loop.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
