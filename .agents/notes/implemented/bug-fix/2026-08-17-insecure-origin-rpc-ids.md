# Agent Note: RPC ids on insecure origins

Status: implemented

English | [中文](2026-08-17-insecure-origin-rpc-ids.zh.md)

## Problem

Browsers gate `crypto.randomUUID` behind secure contexts: it exists on HTTPS pages and `localhost`, and nowhere else. The Web GUI itself prints plain-HTTP LAN URLs (`dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.5:3080)`), so a page loaded from such an origin has no `randomUUID` — and `AbstractApiClient.mintRpcId` called it directly, which means every `/api` request from the browser threw `crypto.randomUUID is not a function` before reaching the network. The whole RPC surface (settings included) was dead on exactly the deployments the printed LAN URLs address. One more browser-reachable call site shared the flaw: the conversation composer's draft-attachment ids. `crypto.getRandomValues`, by contrast, is exposed on every browser origin and by Node's webcrypto global.

## Decision

Mint browser-reachable ids through a shared dependency-free generator, `randomUuid()` in the new `@deepseek-ai/dsh-random-uuid` (`packages/util/random-uuid`): RFC 4122 version 4 from `getRandomValues` alone, mirroring the `dsh-brand`/`dsh-timeout` shape of the util group. Four call sites changed: `mintRpcId` in `dsh-host-apiproxy` (the root fix), the composer's `browserDraftAttachment` in `dsh-client-ui-conversation`, `createMessage` in `dsh-llm` (an `INLINE_SAFE` wire layer inlined into browser bundles, so its message factories are browser-reachable), and the connection client's own correlation ids, whose private copy of the same function the new package replaces. Browser identity is a platform module: `PLATFORM_MODULES` + the shell's static seed table share one instance, so both direct imports and the requires that survive inside inlined prebuilt wire layers resolve through the frozen module table. Genuinely host-only code keeps `crypto.randomUUID` where it has it — the gate is a browser behavior, not a Node one.

The behavior is pinned at unit level by stubbing `globalThis.crypto` to a `getRandomValues`-only object and running the full in-process wire round trip; the browser-only condition cannot be replayed by the Node-driven snapshot harness, whose carrier always has `randomUUID`.

## Alternatives considered

- **Serve the GUI over HTTPS.** Rejected as the fix: the printed plain-HTTP LAN URL is a supported deployment posture, and a secure-context-gated API is a code bug under it, not a deployment error. TLS remains worthwhile for hostile-network confidentiality, behind a reverse proxy (the webserver has no TLS config), and changes nothing for localhost deployments.
- **`crypto.randomUUID?.() ?? fallback()`.** Rejected: two code paths for one behavior, and the native fast path buys nothing at per-request id volume.

## Consequences

- The full RPC surface works from any origin the GUI can be loaded from, secure or not; settings pages no longer error on plain-HTTP LAN access.
- Browser-reachable code minting ids has one home; adding a caller is an import, not another copy of the bit-twiddling.
