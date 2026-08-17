/** Behavior of the /api socket-source fence: canonical CIDR parsing and membership. */

import { describe, expect, it } from 'vitest'
import { acceptsTrustedSource, isTrustedSource, parseTrustedNetwork } from '../src/trusted-network.ts'

function networks(...entries: string[]): ReturnType<typeof parseTrustedNetwork>[] {
  return entries.map(parseTrustedNetwork)
}

describe('parseTrustedNetwork', () => {
  it('accepts canonical IPv4 CIDRs across prefix lengths', () => {
    expect(parseTrustedNetwork('192.168.100.0/24')).toEqual({ network: 0xc0a86400, bits: 24 })
    expect(parseTrustedNetwork('10.147.20.0/24')).toEqual({ network: 0x0a931400, bits: 24 })
    expect(parseTrustedNetwork('0.0.0.0/0')).toEqual({ network: 0, bits: 0 })
    expect(parseTrustedNetwork('203.0.113.7/32')).toEqual({ network: 0xcb007107, bits: 32 })
    expect(parseTrustedNetwork('10.0.0.0/8')).toEqual({ network: 0x0a000000, bits: 8 })
  })

  it('refuses entries a silent rewrite would broaden or narrow', () => {
    // No or doubled prefix separator.
    for (const entry of ['192.168.100.0', '192.168.100.0/24/16', '/24', '192.168.100.0/']) {
      expect(() => { parseTrustedNetwork(entry) }).toThrow(/not a canonical IPv4 CIDR/)
    }
    // Non-canonical octets: WHATWG-adjacent spellings and out-of-range values.
    for (const entry of ['192.168.010.0/24', '256.0.0.0/24', '192.168.100/24', '0x7f.0.0.0/24']) {
      expect(() => { parseTrustedNetwork(entry) }).toThrow(/not a canonical IPv4 CIDR/)
    }
    // Prefix spelling and range.
    for (const entry of ['192.168.100.0/024', '192.168.100.0/33', '192.168.100.0/x', '192.168.100.0/+24']) {
      expect(() => { parseTrustedNetwork(entry) }).toThrow(/not a canonical IPv4 CIDR/)
    }
    // Host bits set: the operator wrote a host, not the network that matches.
    for (const entry of ['192.168.100.5/24', '10.147.20.1/24', '1.2.3.4/1']) {
      expect(() => { parseTrustedNetwork(entry) }).toThrow(/not a canonical IPv4 CIDR/)
    }
    // IPv6: the webserver's non-loopback bind is the IPv4 all-interfaces literal.
    for (const entry of ['::1/128', 'fe80::/10', '2001:db8::/32']) {
      expect(() => { parseTrustedNetwork(entry) }).toThrow(/not a canonical IPv4 CIDR/)
    }
  })
})

describe('isTrustedSource', () => {
  it('trusts loopback sources in every Node spelling regardless of the declared list', () => {
    const none = networks('192.168.100.0/24')
    for (const address of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) {
      expect(isTrustedSource(address, none)).toBe(true)
      expect(isTrustedSource(address, [])).toBe(true)
    }
  })

  it('matches members across the declared networks and refuses everything else', () => {
    const lan = networks('192.168.100.0/24', '10.147.20.0/24', '203.0.113.7/32')
    for (const address of ['192.168.100.1', '192.168.100.254', '10.147.20.0', '10.147.20.255', '203.0.113.7',
      '::ffff:192.168.100.50', '::FFFF:10.147.20.9']) {
      expect(isTrustedSource(address, lan)).toBe(true)
    }
    for (const address of ['192.168.101.1', '10.147.21.1', '203.0.113.8', '0.0.0.0', '::ffff:203.0.113.8']) {
      expect(isTrustedSource(address, lan)).toBe(false)
    }
  })

  it('never trusts an absent or unparseable source', () => {
    const lan = networks('0.0.0.0/0')
    expect(isTrustedSource(undefined, lan)).toBe(false)
    expect(isTrustedSource('', lan)).toBe(false)
    expect(isTrustedSource('not-an-address', lan)).toBe(false)
    expect(isTrustedSource('fe80::1', lan)).toBe(false)
    // Leading-zero octets are canonical-refused, not leniently parsed.
    expect(isTrustedSource('010.147.20.1', lan)).toBe(false)
  })
})

describe('acceptsTrustedSource', () => {
  it('is vacuous with no declared networks — the header fence alone decides', () => {
    expect(acceptsTrustedSource(undefined, [])).toBe(true)
    expect(acceptsTrustedSource('203.0.113.9', [])).toBe(true)
  })

  it('follows membership once networks are declared', () => {
    const lan = networks('192.168.100.0/24')
    expect(acceptsTrustedSource('192.168.100.50', lan)).toBe(true)
    expect(acceptsTrustedSource('127.0.0.1', lan)).toBe(true)
    expect(acceptsTrustedSource('10.147.20.7', lan)).toBe(false)
    expect(acceptsTrustedSource(undefined, lan)).toBe(false)
  })
})
