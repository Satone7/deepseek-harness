/**
 * Socket-source trust for the `/api` fence: validated IPv4 CIDR networks whose
 * member addresses a deployment treats like loopback. The header fence
 * (api-request-trust.ts) binds what a browser believes it is talking to; a
 * declared network instead vouches for where the connection came from — a TCP
 * source address cannot be forged without terminating the handshake on the
 * return path. Declaring networks is the deployment's statement that its LANs
 * may use this server unrestricted, configuration plane included; it is a
 * reachability policy over origins the operator controls, still not
 * authentication of individual users.
 */

/** One validated trusted-network entry: a canonical IPv4 CIDR block. */
export interface TrustedNetwork {
  /** Network address with host bits cleared, four octets packed big-endian. */
  readonly network: number
  /** Prefix length in bits (0-32). */
  readonly bits: number
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
 * Anything a silent rewrite would broaden or narrow — a missing or second `/`,
 * non-dotted-quad or zero-padded octets, a prefix over 32, or host bits set
 * (`192.168.100.5/24`) — fails the load loudly instead of authorizing a range
 * the operator did not write. IPv6 is refused: the webserver's non-loopback
 * bind is the IPv4 all-interfaces literal, so an IPv6 entry could only be a
 * deployment this carrier never serves.
 * @param entry - the configured value, verbatim.
 * @returns the parsed network address and prefix length.
 */
export function parseTrustedNetwork(entry: string): TrustedNetwork {
  const invalid = (): Error => new Error(
    `client-connection: trustedNetworks entry ${JSON.stringify(entry)} is not a canonical IPv4 CIDR (a.b.c.d/p, host bits zero)`,
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
  // `&` yields a signed int32; normalize before comparing against the
  // `>>> 0`-packed network so high addresses (≥128.0.0.0) compare unsigned.
  if (((network & mask) >>> 0) !== network) throw invalid()
  return { network, bits }
}

/**
 * Parse a socket source address into a packed IPv4 value, normalizing Node's
 * IPv6-mapped spelling (`::ffff:192.168.100.5`); any other IPv6 or malformed
 * value has no IPv4 position to compare.
 */
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
 * @param remoteAddress - the connection's source address, undefined when the
 * carrier exposes none.
 * @param networks - parsed trustedNetworks entries.
 * @returns true for loopback sources and in-network sources; undefined and
 * unparseable addresses are never trusted.
 */
export function isTrustedSource(
  remoteAddress: string | undefined,
  networks: readonly TrustedNetwork[],
): boolean {
  if (remoteAddress === undefined) return false
  const v4 = sourceV4(remoteAddress)
  if (v4 !== undefined) {
    if (v4 >>> 24 === 127) return true
    // Unsigned comparison for the same reason as the load-time parse check.
    return networks.some(network => ((v4 & maskOf(network.bits)) >>> 0) === network.network)
  }
  return remoteAddress.toLowerCase() === '::1'
}

/**
 * Whether a request source passes the deployment's network gate. With no
 * trusted networks declared the gate is vacuous — the header fence alone
 * decides, preserving the loopback deployment's behavior exactly.
 * @param remoteAddress - the connection's source address, undefined when the
 * carrier exposes none.
 * @param networks - parsed trustedNetworks entries.
 * @returns true unless networks are declared and the source is outside them
 * (and not loopback).
 */
export function acceptsTrustedSource(
  remoteAddress: string | undefined,
  networks: readonly TrustedNetwork[],
): boolean {
  return networks.length === 0 || isTrustedSource(remoteAddress, networks)
}
