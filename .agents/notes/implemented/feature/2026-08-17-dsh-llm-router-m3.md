# Agent Note: dsh-llm-router M3 persistence and observability

Status: implemented

English | [中文](2026-08-17-dsh-llm-router-m3.zh.md)

## Problem

M2 kept cooldown, circuit-breaker, inflight, and last-error state only in process memory. A restart lost outage/cooldown knowledge, and operators had no built-in visibility into routing decisions or failover events.

## Decision

M3 adds optional durable state and logging to `@deepseek-ai/dsh-llm-router` without changing M2 routing semantics.

- A new `llm_router` storage-domain (`states` table) persists per-candidate `inflight`, `consecutiveFailures`, `circuit`, `cooldownUntil`, and `lastError`.
- When `ctx.storageDomain` / `ctx.storage.domain` is mounted, the router opens the domain during `apply`, restores state for candidates that still exist, and writes through the storage-domain write chain on route, failover, half-open transition, and success. Unknown or malformed rows are ignored.
- If storage is unavailable or fails to open, the router logs a warning and continues with in-memory state, so existing M0-M2 deployments keep working unchanged.
- Routing, failover, and all-unavailable decisions are logged through `ctx.logger` for observability.
- The router registers an `llm-router` settings namespace (restart-applies) and a Web Settings **Plugins** card. The card edits routing `pools` as validated JSON.

## Alternatives considered

- **Require storage-domain always.** That would break existing users who run the router without the storage form and contradict the plugin's optional-add-on posture.
- **Persist only cooldown/circuit.** Inflight is also part of the M2 runtime state and useful for restart visibility, even though a crashed process can leave a stale count until it decays.
- **Emit custom session events for every route.** Logging is lighter-weight and avoids extending the session event vocabulary for internal routing telemetry.
- **Build a deeply nested form for pools/candidates.** A JSON document editor is simpler for the structural router config and still schema-validated on save.

## Consequences

- Cooldown/circuit/last-error survive restarts when storage is mounted. Inflight is persisted too; stale inflight from a crashed process is a known limitation.
- Multi-process consistency is best-effort: each process refreshes from the shared medium on start and writes use last-writer-wins. Live cross-process event sync is not implemented.
- A durable write failure is logged and does not block request routing; the in-memory state remains authoritative for the current process.
- The package now depends on `@deepseek-ai/dsh-storage-domain` as a peer for the optional persistence path and `zod` for the durable schema.

## Testing

Package tests cover state key/serialization helpers, restart restoration of failover cooldown, inflight persistence before completion and clearing after success, unknown/malformed row skipping, half-open transition persistence, durable write failure tolerance, storage-open failure fallback, settings namespace registration, and per-file 100% coverage. The settings-plugins client suite covers the JSON textarea card, JSON field parsing, and card registration.
