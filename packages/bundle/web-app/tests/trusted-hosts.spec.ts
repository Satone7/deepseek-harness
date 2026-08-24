/** Single-sample LAN-trust resolution for the /api browser-trust fence (`resolveLanTrust`). */

import { describe, expect, it, vi } from 'vitest'
import { resolveLanTrust } from '../src/index.ts'

vi.mock('node:os', () => ({
  networkInterfaces: () => ({
    lo0: [
      { family: 'IPv4', internal: true, address: '127.0.0.1' },
    ],
    en0: [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '192.168.1.5' },
    ],
    en1: [
      { family: 'IPv4', internal: false, address: '10.0.0.7' },
    ],
    utun0: undefined,
  }),
}))

describe('resolveLanTrust', () => {
  it('derives every non-internal IPv4 interface when no network is declared: the vacuous gate', () => {
    const { lanAddresses, trustedHosts, trustedNetworks } = resolveLanTrust(
      '0.0.0.0',
      ['harness.internal:3080'],
      [],
    )
    expect(lanAddresses).toEqual(['192.168.1.5', '10.0.0.7'])
    expect(trustedHosts).toEqual(['192.168.1.5', '10.0.0.7', 'harness.internal:3080'])
    expect(trustedNetworks).toEqual([])
  })

  it('keeps only member interfaces once a network is declared — non-member LAN authorities never become trusted hosts', () => {
    const { lanAddresses, trustedHosts, trustedNetworks } = resolveLanTrust(
      '0.0.0.0',
      ['harness.internal:3080'],
      ['10.0.0.0/24'],
    )
    // 192.168.1.5 stays reachable on the wire but is no longer a fence authority.
    expect(lanAddresses).toEqual(['10.0.0.7'])
    expect(trustedHosts).toEqual(['10.0.0.7', 'harness.internal:3080'])
    expect(trustedNetworks).toEqual(['10.0.0.0/24'])
  })

  it('declared networks disjoint from every interface derive an empty LAN set without failing', () => {
    expect(resolveLanTrust('0.0.0.0', [], ['10.147.20.0/24']))
      .toEqual({ lanAddresses: [], trustedHosts: [], trustedNetworks: ['10.147.20.0/24'] })
  })

  it('derives nothing for a loopback bind — extras alone stand, no LAN URL to print', () => {
    expect(resolveLanTrust('127.0.0.1', [], [])).toEqual({ lanAddresses: [], trustedHosts: [], trustedNetworks: [] })
    expect(resolveLanTrust('127.0.0.1', ['lab.internal'], ['192.168.100.0/24']))
      .toEqual({ lanAddresses: [], trustedHosts: ['lab.internal'], trustedNetworks: ['192.168.100.0/24'] })
  })
})
