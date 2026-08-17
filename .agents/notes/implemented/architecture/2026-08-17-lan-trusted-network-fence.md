# Agent Note: LAN trusted-network fence for `/api` socket sources

Status: implemented

English | [中文](2026-08-17-lan-trusted-network-fence.zh.md)

## Problem

The `/api` browser-trust fence binds what a request claims about itself: `Host`, `Origin`, and Fetch-Metadata headers. That defends the two browser confused-deputy paths (DNS rebinding, cross-site reads) but leaves a deployment with no way to say "my LAN is mine": an all-interfaces bind derives the machine's LAN IP literals into `trustedHosts`, so ordinary methods answer any network that can route to the port, while the privileged set (`settings.*`, `credentials.*`, `agentPreset.*` reads and roster writes, native desktop actions, `llm.discoverModels`) stays pinned to a loopback `Host`. A LAN operator therefore gets a half-working GUI — every settings card 403s with `transport failure for /api/settings.describe: HTTP 403` — and the CLI refuses `--host 0.0.0.0` outright, pushing operators into cordis.yml workarounds with no trust statement at all.

## Decision

Trust the connection's origin, not its claims: a new `trustedNetworks` config on `dsh-client-connection` (`src/trusted-network.ts`) declares IPv4 CIDRs whose socket source addresses the deployment vouches for. A TCP source address cannot be forged without terminating the handshake, so the declaration is a statement about machines, not headers. The gate composes with the existing header fence, it does not replace it:

- With networks declared, every `/api` request and both event upgrades must originate from loopback or a member network; every other source is refused 403 before any Host or Origin judgment, so an all-interfaces bind no longer answers untrusted networks at all.
- Member (and loopback) sources also clear the privileged-method loopback pin: a trusted-LAN client reaches the whole configuration plane exactly like a local one. The widening is strictly opt-in — with no networks declared the pin is byte-for-byte the old loopback-`Host` check, so `isTrustedSource`'s always-true loopback arm cannot leak privileged access through a non-loopback `Host`.
- The Host/Origin fences keep running unchanged for every accepted source: a rebound or cross-site browser inside the trusted LAN is still refused, because the declaration vouches for where the connection came from, not for what a page inside that network may ask.
- The bridge passes the socket's `remoteAddress` to the fetch-shaped handler as a typed `FetchSource` value — a same-process transport fact, never a header a client could forge.
- Entries must be canonical IPv4 CIDRs with zero host bits (`192.168.100.5/24` fails the load loudly, as does any IPv6 or zero-padded spelling); matching normalizes Node's `::ffff:` mapped form and compares unsigned (`&` yields signed int32 — the naive comparison silently refuses every network ≥128.0.0.0, which the parse and membership tests pin).
- The CLI grows a repeatable `--trusted-network` flag feeding the same `webRuntime` seam as `--trusted-host`, and `dsh web --host 0.0.0.0` is accepted exactly when at least one network is declared — the reachability ask and the trust statement travel together.

This is still not per-user authentication: everyone on the declared wires is accepted. It is the operator scoping a single-user deployment to networks they control, which is the honest contract for a harness whose sessions already run bash.

## Alternatives considered

- **Widen `trustedHosts` to cover privileged methods.** Rejected: Host is a client-claimed header, so the privileged plane would open to any process anywhere that writes `Host: <declared>` — the old pin's spoofability, promoted to policy.
- **An authentication layer (tokens/passwords).** Deferred, as before: the LAN operator's ask is "my networks behave like my keyboard", which source scoping answers exactly; token minting/rotation remains real product surface for genuinely hostile networks.
- **Keep refusing `--host 0.0.0.0` at the CLI.** Rejected: operators already reach all-interfaces binds through cordis.yml, with no gate and no declared intent; a paired `--trusted-network` requirement converts the workaround into an explicit, checkable contract.

## Consequences

- `dsh --profile web --host 0.0.0.0 --trusted-network 192.168.100.0/24 --trusted-network 10.147.20.0/24` serves the full GUI — settings, credentials, presets, native pickers included — to exactly those subnets and loopback.
- No declaration, no change: loopback deployments and header-fenced LAN deployments behave exactly as before, pinned by tests on both postures.
- HTTP remains the carrier; nothing in the fence demands TLS. A reverse proxy that rewrites `Host` still needs `--trusted-host` for the name it publishes, unchanged from the header fence's contract.
- The dedicated-channel and interceptor registration paths apply the same source gate, so no `/api`-family route widens or narrows independently of the declaration.
