# `@deepseek-ai/dsh-llm-router`

English | [中文](README.zh.md)

Function plugin that maps a virtual provider or model route to a real candidate through the agent loop's `agent/request` waterfall and recovers from provider failures on `agent/request-error`. It does not wrap `ctx.llm.stream()` or implement a protocol adapter: `dsh-llm-pi-ai` / `dsh-llm-deepseek` remain the actual provider adapters, and this plugin only rewrites the proposed call config before adapter preparation.

A routing pool's `id` is the virtual route. The listener awaits `next()` to obtain the machine's `LlmCallConfig`, then routes when its `provider` or `model` equals a pool id; a provider match wins when both fields match different pools. A routed config keeps every other field (`maxTokens`, `stop`, and future call-config fields) and replaces only `provider` and `model` with the selected candidate. Requests that name no pool delegate untouched, so an empty `pools` list is the dormant posture.

```yaml
- name: '@deepseek-ai/dsh-llm-router'
  config:
    pools:
      - id: auto-code
        strategy: weighted-random
        candidates:
          - id: zhipu
            provider: zhipu
            model: glm-4.7
            weight: 2
            quotaProbe:
              kind: zhipu
              apiKeyEnv: ZHIPU_API_KEY
              maxPercentage: 90
          - id: kimi
            provider: kimi
            model: kimi-k2.5
            quotaProbe:
              kind: kimi
              apiKeyEnv: KIMI_API_KEY
              maxPercentage: 90
          - id: deepseek
            provider: deepseek
            model: deepseek
            quotaProbe:
              kind: deepseek-balance
              apiKeyEnv: DEEPSEEK_API_KEY
              minBalance: 10
```

`weighted-random` (default) samples one candidate with probability proportional to its positive-integer `weight` (default 1). `round-robin` visits candidates in declaration order once per cycle, skips quota/runtime-excluded candidates, and keeps its full-pool cursor so eligibility changes do not reset the cycle; weights are ignored. `score-weighted` multiplies each candidate's base `weight` by a live 0..1 score built from availability, load, and stability, then samples proportionally. All strategies start a new selection when a new agent first proposes the virtual route; after the loop logs the effective header, subsequent requests reuse the selected real route unless a later proposal changes it or a failover forces a new route.

Candidates may declare one built-in `quotaProbe` and an optional `maxInflight` cap. Before selection the router resolves `apiKeyEnv` per request through `ctx.credentials` (falling back to the launch-environment snapshot when that seam is absent), queries the provider, and removes candidates whose quota is exhausted: a percentage probe uses `percentage < maxPercentage` (default 100), and `deepseek-balance` uses `balance > minBalance` (default 0). Results are cached per candidate, key, and provider with `ttlSeconds` (default 300); a refresh failure returns the stale snapshot when one exists. A candidate with a missing credential or a failed probe and no cached snapshot is excluded, and a pool with no eligible candidate fails the request with `QUOTA`. The router also excludes candidates in cooldown, with an open circuit, or at their `maxInflight`.

The config schema validates pool/candidate ids, provider and model names, weights, `maxInflight`, strategies, probe kinds, credential references, thresholds, TTLs, and non-empty candidate lists. `apply` re-checks the same invariants so direct callers fail loud at plugin load; duplicates and empty ids are never silently skipped.

M2 runtime state is kept per candidate. `agent/request-error` marks `QUOTA` with a longer cooldown, `RATE_LIMIT` with `Retry-After` or a default cooldown, and `SERVER`/`TIMEOUT` with circuit-breaker counts. When at least one other candidate remains available, the router returns `{ kind: 'retry' }` and the next `agent/request` is forced back through the same virtual pool, skipping the failed candidate. When every candidate is unavailable, the router calls `next()` and leaves the original failure or downstream retry policy in charge, so it never invents an unbounded retry loop. A successful `assistant/message` releases the inflight reservation and resets the circuit state.

## Persistence and Observability

When the `storage-domain` form is mounted (`ctx.storage.domain` / `ctx.storageDomain`), the router opens a `llm_router` domain with a `states` table and persists each candidate's cooldown, circuit, inflight, and last error. Writes are serialized through the storage-domain write chain and awaited on routing and failover paths, so a durable failure is logged but never blocks request routing. On plugin start the router restores persisted state for candidates that still exist; unknown or malformed rows are ignored. If storage is unavailable or fails to open, the router logs a warning and continues with in-memory state, preserving the M2 behavior.

Routing, failover, and all-unavailable decisions are also written to the plugin logger (`ctx.logger`) for observability.

The router registers an `llm-router` settings namespace (restart-applies) and a **Plugin configuration** card in the Web Settings **Plugins** page. The card edits the routing `pools` document as validated JSON; changes are written to the user settings layer and take effect after restart.

## Model Experience

### Request routing and quota probes

#### What the model sees

Routing and quota decisions are not model-visible. The model receives the same request content under the selected real provider/model; the loop records the effective provider/model in the durable `request/header` as it does for any explicit selection. When every candidate is quota-excluded, the turn error is model-visible as a coded request failure.

#### Token effect

Routing and quota probes add no prompt tokens and no response token markup. Actual token billing is the selected provider/model's billing and may differ from another candidate's tokenization or pricing.

#### KV Cache effect

Provider and model are cache-identity fields. The first routed request changes the effective route and therefore the cache identity; later requests that reuse the logged real route keep prefix-stable cache behavior, while a later route change invalidates reuse exactly like an explicit provider/model change.

## Known Limitations and Deferred Work

- **Durable state depends on storage-domain** — cooldown, circuit, inflight, and last error are persisted when `storage-domain` is mounted; without it the router falls back to in-memory state. Cross-process live synchronization is not implemented: each process refreshes from the shared medium on start and writes use last-writer-wins.
- **Main conversation requests only** — auxiliary LLM calls that use `ctx.llm.stream()` directly do not pass through `agent/request` and are not routed.
- **Sticky after success** — after a successful routed request, later requests reuse the logged real route; failover re-routes only when `agent/request-error` sees a recoverable failure and another candidate is available.
- **Built-in probes only** — generic `http`/`script` probes, provider-specific cache invalidation, and multi-process quota consistency are not implemented.
- **Round-robin cursor is per-process** — the cursor is not persisted, and smooth weighted round-robin is not implemented.
- **Pool ids share the provider/model namespace** — a real model or provider whose name equals a pool id is treated as a virtual route; deployments own that collision.
