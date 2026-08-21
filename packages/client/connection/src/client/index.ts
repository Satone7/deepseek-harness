/**
 * Browser wire client. The plugin selects fixture or HTTP transport, provides
 * the shared API client, and lets the runtime object layer start the stream
 * controller with its sinks.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostDescription, IApiClient } from './api.ts'
import { ConnectionController, type ConnectionConfig, type ConnectionSinks, type ConnectionState } from './connection.ts'
import { FixtureApiClient } from './fixture.ts'
import { WebApiClient } from './web-api-client.ts'
import { createWebConnectionRpc } from './rpc.ts'
import { isLoopbackHostname } from '../loopback-hostname.ts'
import { WEB_TRUST_GLOBAL, type WebTrust } from '../web-trust.ts'
import { WEB_VERSION_GLOBAL } from '../web-version.ts'
import type { ClientConnectionRpc } from '../rpc.ts'

// ---- Contract re-exports (browser-safe apiproxy channels + core types) ----
export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, PromptContentPart, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  ToolCallView, ToolResultView, WorkspaceApi, WorkspaceId, WorkspaceView,
  SkillsApi, SkillEntry,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  MessageId, ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  SubagentsApi, SubagentAddress, SubagentCatalog, SubagentListEntry, SubagentPromptReceipt,
  JobView,
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
  HostDescription, IApiClient, SessionId, SessionEvent, ContentBlock, StreamChunk,
  GoalsApi, GoalRef,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
} from './api.ts'
export {
  RpcId,
  AbstractApiClient,
  transportError,
} from './api.ts'

// Connection loop types are public through ConnectionHandle.start; the
// controller remains package-internal.
export type { ConnectionConfig, ConnectionSinks, ConnectionState }
export type { ClientConnectionRpc } from '../rpc.ts'
export { WEB_TRUST_GLOBAL, type WebTrust } from '../web-trust.ts'
export { WEB_VERSION_GLOBAL } from '../web-version.ts'

/** Observable Host description published by each completed connection handshake. */
export interface HostDescriptionSource {
  /** Latest connected-generation description; absent before connect and while reconnecting. */
  getSnapshot(): HostDescription | undefined
  /** Subscribe to description replacement and connection loss. */
  subscribe(listener: () => void): () => void
}

/** Required services (none — this is the wire root). */
export const inject: string[] = []

type TrustWindow = { [WEB_TRUST_GLOBAL]?: Partial<WebTrust> }

/** Read the trust fence injected by the host Web bundle, if present. */
function readWebTrust(): Partial<WebTrust> | undefined {
  return (globalThis as TrustWindow)[WEB_TRUST_GLOBAL]
}

type VersionWindow = { [WEB_VERSION_GLOBAL]?: string }

/** Read the product version injected by the host Web bundle, if present. */
function readWebVersion(): string | undefined {
  return (globalThis as VersionWindow)[WEB_VERSION_GLOBAL]
}

/**
 * The ctx.connection service API: the API client plus a one-shot
 * controller starter (the runtime plugin supplies sinks when its object layer
 * is ready — connection stays consumer-agnostic).
 */
export interface ConnectionHandle {
  /** Shared api client (fixture or real, decided at boot from the page URL). */
  readonly api: IApiClient
  /**
   * Whether the current page authority is loopback or a trusted-LAN authority.
   * Non-browser contexts default to true. This is the client-side mirror of
   * the Host fence's privileged-method widening: with `trustedNetworks`
   * declared, a page served through a matching `trustedHosts` authority can
   * use the full local configuration/native plane.
   */
  readonly isLoopback: boolean
  /**
   * Product version of the serving dsh Web bundle, mirrored from the page
   * injection (`__DSH_WEB_VERSION__`). Absent when the page was not served by
   * the Web host (component harnesses, non-browser contexts).
   */
  readonly webVersion: string | undefined
  /** Generation-scoped Host facts, including native path-open capability. */
  readonly hostDescription: HostDescriptionSource
  /** Generic logical RPC channels over the same Connection transport. */
  readonly rpc: ClientConnectionRpc
  /**
   * Start the connect/pump/reconnect loop with the consumer's frame sinks.
   * One consumer owns the streams (the runtime object layer); a second call
   * throws.
   * @param sinks - frame/state callbacks.
   * @param config - reconnect/backoff tunables.
   * @returns stop handle for the loop.
   */
  start(sinks: ConnectionSinks, config?: ConnectionConfig): { stop(): void }
}

/**
 * Whether the current page authority appears in `trustedHosts`.
 *
 * This is intentionally browser-safe and mirrors the Host fence's authority
 * matching for the common shapes the CLI derives (port-less LAN IP literals)
 * and explicit `host:port` entries. It is only meaningful when the deployment
 * has also declared `trustedNetworks`; `trustedHosts` alone is a header fence
 * and does not widen privileged methods.
 */
function isTrustedPageHost(
  page: { hostname: string; host?: string },
  trustedHosts: readonly string[],
): boolean {
  const hostname = page.hostname.toLowerCase()
  const host = page.host?.toLowerCase()
  return trustedHosts.some((entry) => {
    let entryUrl: URL
    try {
      entryUrl = new URL(`http://${entry}`)
    } catch {
      return false
    }
    if (entryUrl.hostname.toLowerCase() !== hostname) return false
    if (entryUrl.port === '') return true
    const port = page.host !== undefined
      ? host?.split(':').pop()
      : undefined
    return port !== undefined && port === entryUrl.port
  })
}

/**
 * Client plugin body: pick the api by page mode and provide ctx.connection.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  const pageLocation = typeof location === 'undefined' ? undefined : location
  const webTrust = readWebTrust()
  const webVersion = readWebVersion()
  const trustedHosts = webTrust?.trustedHosts ?? []
  const trustedNetworks = webTrust?.trustedNetworks ?? []
  const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture')
  const fixtureClient = fixture ? new FixtureApiClient() : undefined
  const api: IApiClient = fixtureClient ?? new WebApiClient()
  const rpc = fixtureClient?.rpc ?? createWebConnectionRpc()
  let started = false
  let description: HostDescription | undefined
  const descriptionListeners = new Set<() => void>()
  const publishDescription = (next: HostDescription | undefined): void => {
    if (Object.is(description, next)) return
    description = next
    for (const listener of [...descriptionListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[web-runtime] host-description listener threw:', error)
      }
    }
  }
  const handle: ConnectionHandle = {
    api,
    isLoopback: pageLocation === undefined
      || isLoopbackHostname(pageLocation.hostname)
      || (trustedNetworks.length > 0 && isTrustedPageHost(pageLocation, trustedHosts)),
    webVersion,
    hostDescription: {
      getSnapshot: () => description,
      subscribe: (listener) => {
        descriptionListeners.add(listener)
        return () => { descriptionListeners.delete(listener) }
      },
    },
    rpc,
    start(sinks, config) {
      if (started) throw new Error('connection: the stream loop is already owned by another consumer')
      started = true
      const controller = new ConnectionController(api, {
        ...sinks,
        onConnected: (next) => {
          publishDescription(next)
          // A description subscriber may synchronously stop the loop. In that
          // case publishDescription(undefined) has already retracted this
          // generation, so do not leak its stale connected notification to
          // the consumer sink afterward.
          if (!Object.is(description, next)) return
          sinks.onConnected?.(next)
        },
        onStateChange: (state) => {
          if (state === 'reconnecting') publishDescription(undefined)
          sinks.onStateChange?.(state)
        },
      }, config ?? {})
      controller.start()
      return {
        stop: () => {
          controller.stop()
          publishDescription(undefined)
        },
      }
    },
  }
  ctx.provide('connection', handle)
}
