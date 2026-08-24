/**
 * Browser-trust fence for the /api/dsh-token-cost route family, mirroring
 * the official /api gateway fence in @deepseek-ai/dsh-client-connection
 * (packages/client/connection/src/api-request-trust.ts + trusted-network.ts,
 * BSD-3-Clause, copied here because the package does not export these
 * helpers and this plugin must not depend on its internals).
 *
 * Two gates compose, exactly like the official gateway:
 * - `isTrustedApiRequest` — the Host-header fence (DNS-rebinding / cross-site
 *   defense): loopback Host or a deployment `trustedHosts` authority, plus
 *   same-origin browser markers.
 * - `acceptsTrustedSource` — the socket-source gate: loopback or a member of
 *   the deployment's `trustedNetworks` CIDRs. With no networks declared the
 *   gate is vacuous, so the loopback deployment behaves exactly as before.
 *
 * The deployment's trusted hosts/networks are read from the live
 * `ctx.webRuntime` service value (the same source the official gateway's
 * trust list derives from), so `--trusted-host` / `--trusted-network`
 * invocations apply to these routes too.
 */
import type { IncomingHttpHeaders } from 'node:http'

/** One validated trusted-network entry: a canonical IPv4 CIDR block. */
export interface TrustedNetwork {
  /** Network address with host bits cleared, four octets packed big-endian. */
  readonly network: number
  /** Prefix length in bits (0-32). */
  readonly bits: number
}

/** Whether a normalized URL hostname names the local loopback authority. */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Decide whether one request passes the Host-header fence.
 * @param request - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @returns true when the Host is ours (loopback or trusted) and any attached browser markers are same-origin.
 */
export function isTrustedApiRequest(request: { headers: IncomingHttpHeaders }, trustedHosts: readonly string[]): boolean {
  const host = request.headers.host
  if (typeof host !== 'string') return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Prefix mask for a bit count: `/0` matches everything, `/32` one address. */
function maskOf(bits: number): number {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
}

/** Parse one decimal octet: 0-255, no leading zeros. Returns -1 when invalid. */
function octet(text: string): number {
  if (!/^\d{1,3}$/.test(text) || (text.length > 1 && text.startsWith('0'))) return -1
  const value = Number(text)
  return value <= 255 ? value : -1
}

/**
 * Validate and parse one `trustedNetworks` entry as a canonical IPv4 CIDR.
 * Anything a silent rewrite would broaden or narrow fails loudly; the
 * official gateway already validated the same entries at load, so a failure
 * here means the plugin and gateway disagree on the source.
 * @param entry - the configured value, verbatim.
 * @returns the parsed network address and prefix length.
 */
export function parseTrustedNetwork(entry: string): TrustedNetwork {
  const invalid = (): Error => new Error(
    `dsh-token-cost: trustedNetworks entry ${JSON.stringify(entry)} is not a canonical IPv4 CIDR (a.b.c.d/p, host bits zero)`,
  )
  const slash = entry.indexOf('/')
  if (slash < 0) throw invalid()
  const address = entry.slice(0, slash)
  const prefix = entry.slice(slash + 1)
  const parts = address.split('.')
  if (parts.length !== 4 || prefix.includes('/')) throw invalid()
  let network = 0
  for (const part of parts) {
    const value = octet(part)
    if (value < 0) throw invalid()
    network = ((network << 8) | value) >>> 0
  }
  if (!/^\d{1,2}$/.test(prefix) || (prefix.length > 1 && prefix.startsWith('0'))) throw invalid()
  const bits = Number(prefix)
  if (bits > 32) throw invalid()
  const mask = maskOf(bits)
  if (((network & mask) >>> 0) !== network) throw invalid()
  return { network, bits }
}

/** Parse a socket source address into a packed IPv4 value, normalizing Node's IPv6-mapped spelling. */
function sourceV4(remoteAddress: string): number | undefined {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(remoteAddress)
  const text = mapped?.[1] ?? remoteAddress
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    const oct = octet(part)
    if (oct < 0) return undefined
    value = ((value << 8) | oct) >>> 0
  }
  return value
}

/**
 * Whether a socket source address is this machine (IPv4 loopback in any Node
 * spelling) or a member of one of the trusted networks.
 * @param remoteAddress - the connection's source address, undefined when the carrier exposes none.
 * @param networks - parsed trustedNetworks entries.
 * @returns true for loopback sources and in-network sources; undefined and unparseable addresses are never trusted.
 */
export function isTrustedSource(
  remoteAddress: string | undefined,
  networks: readonly TrustedNetwork[],
): boolean {
  if (remoteAddress === undefined) return false
  const v4 = sourceV4(remoteAddress)
  if (v4 !== undefined) {
    if (v4 >>> 24 === 127) return true
    return networks.some(network => ((v4 & maskOf(network.bits)) >>> 0) === network.network)
  }
  return remoteAddress.toLowerCase() === '::1'
}

/**
 * Whether a request source passes the deployment's network gate. With no
 * trusted networks declared the gate is vacuous — the header fence alone
 * decides, preserving the loopback deployment's behavior exactly.
 * @param remoteAddress - the connection's source address, undefined when the carrier exposes none.
 * @param networks - parsed trustedNetworks entries.
 * @returns true unless networks are declared and the source is outside them (and not loopback).
 */
export function acceptsTrustedSource(
  remoteAddress: string | undefined,
  networks: readonly TrustedNetwork[],
): boolean {
  return networks.length === 0 || isTrustedSource(remoteAddress, networks)
}
