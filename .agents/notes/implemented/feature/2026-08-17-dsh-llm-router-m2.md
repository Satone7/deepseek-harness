# Agent Note: dsh-llm-router M2 failover and load balancing

Status: implemented

English | [中文](2026-08-17-dsh-llm-router-m2.zh.md)

## Problem

M1 of `@deepseek-ai/dsh-llm-router` could filter candidates by quota before selection but had no way to recover after a routed provider failed. Once the agent loop logged the real provider/model in the sticky `request/header`, a later request reused the failed route; there was no cooldown, circuit breaker, or inflight cap to spread load or avoid a hot provider.

## Decision

The router now owns in-memory M2 runtime state per candidate and listens to `agent/request-error` in addition to `agent/request`.

- Each candidate has `ProviderRuntimeState` with `quota`, `inflight`, `consecutiveFailures`, `circuit`, `cooldownUntil`, and `lastError`.
- `agent/request-error` handles only failures from the candidate this agent last routed through. `QUOTA` sets a longer cooldown, `RATE_LIMIT` uses `Retry-After` or a default cooldown, and `SERVER`/`TIMEOUT` feed the circuit breaker. When at least one other candidate remains available, the listener returns `{ kind: 'retry' }` and marks the agent for forced re-entry into the same virtual pool on the next request. When every candidate is unavailable it calls `next()`, preserving the original failure or downstream retry policy and preventing an unbounded retry loop.
- `maxInflight` is an optional per-candidate cap. The router increments inflight when it routes a request and releases it on `assistant/message` success or `agent/request-error` failure.
- `score-weighted` is a new strategy. It multiplies each candidate's base `weight` by a live score composed of availability (quota snapshot), load (inflight relative to `maxInflight`), and stability (consecutive failures). The existing `weighted-random` and `round-robin` strategies keep their prior semantics.
- A successful `assistant/message` releases the inflight reservation and resets cooldown/circuit state.

## Alternatives considered

- **Rely only on `dsh-llm-retry`.** Retry policy can repeat the same provider, which does not solve quota exhaustion or route-level load spreading.
- **Always call `next()` from `agent/request-error`.** This would leave routed providers stuck after a failure and never exercise failover.
- **Route every request through the virtual pool, ignoring the sticky header.** This would rebalance even after success and break the loop's durable header semantics.
- **Persist runtime state in M2.** Storage adds concurrency and migration complexity before the in-process behavior is proven; M3 remains the persistence milestone.

## Consequences

- Failover is in-memory and per-process; cooldown/circuit/inflight do not survive restart or cross processes.
- Explicit requests to a real provider that was never routed by the plugin are not intercepted by `agent/request-error`, preserving the "virtual only" boundary.
- After a successful routed request, later requests remain sticky to the selected real route; failover only changes route when a recoverable error occurs and another candidate is available.
- The router returns retry before downstream `dsh-llm-retry` when it owns recovery; deployments that want retry-first behavior should order plugins accordingly.
- `score-weighted` gives deployments a load-aware strategy without changing the existing defaults.

## Testing

Package tests cover runtime state transitions, score-weighted selection, maxInflight config validation, QUOTA failover to another candidate, all-unavailable delegation to the original error, explicit unmanaged provider non-interception, concurrent maxInflight spreading, and per-file 100% coverage.
