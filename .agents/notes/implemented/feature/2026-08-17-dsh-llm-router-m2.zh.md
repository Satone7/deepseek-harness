# Agent Note: dsh-llm-router M2 故障转移与负载均衡

Status: implemented

[English](2026-08-17-dsh-llm-router-m2.md) | 中文

## 问题

`@deepseek-ai/dsh-llm-router` 的 M1 能在选择前按配额过滤候选，但无法在已路由的提供方失败后恢复。一旦 agent loop 将真实 provider/model 写入粘性的 `request/header`，后续请求就会复用失败路由；也没有冷却、熔断或 inflight 上限来分散负载或避免热点提供方。

## 决策

路由器现在为每个候选维护内存中的 M2 运行态，并在 `agent/request` 之外监听 `agent/request-error`。

- 每个候选都有 `ProviderRuntimeState`，包含 `quota`、`inflight`、`consecutiveFailures`、`circuit`、`cooldownUntil` 和 `lastError`。
- `agent/request-error` 只处理该 agent 最近一次由路由器路由到的候选的失败。`QUOTA` 设置较长冷却，`RATE_LIMIT` 使用 `Retry-After` 或默认冷却，`SERVER`/`TIMEOUT` 计入熔断计数。当至少还有一个候选可用时，监听器返回 `{ kind: 'retry' }` 并将该 agent 标记为下一次请求强制重新进入同一虚拟池。当所有候选都不可用时，它调用 `next()`，保留原始失败或下游重试策略，避免无界重试。
- `maxInflight` 是每个候选可选的上限。路由器在路由请求时增加 inflight，并在 `assistant/message` 成功或 `agent/request-error` 失败时释放。
- `score-weighted` 是新策略。它将每个候选的基础 `weight` 乘以由可用性（配额快照）、负载（相对 `maxInflight` 的 inflight）和稳定性（连续失败次数）构成的实时分数。现有 `weighted-random` 与 `round-robin` 保持原有语义。
- 成功的 `assistant/message` 会释放 inflight 预留并重置冷却/熔断状态。

## 曾考虑的替代方案

- **只依赖 `dsh-llm-retry`。** 重试策略可能重复同一个提供方，无法解决配额耗尽或路由级负载分散。
- **在 `agent/request-error` 中总是调用 `next()`。** 这会让已路由的提供方在失败后一直卡住，无法故障转移。
- **忽略粘性 header，每次都通过虚拟池路由。** 这会在成功后也重新均衡，破坏 loop 的持久化 header 语义。
- **在 M2 就持久化运行态。** 在进程内行为被验证之前引入存储会带来并发与迁移复杂度；M3 仍是持久化里程碑。

## 后果

- 故障转移是内存级、单进程的；冷却/熔断/inflight 不会在重启或跨进程后保留。
- 对未被插件路由过的真实 provider 的显式请求不会被 `agent/request-error` 拦截，保持「仅虚拟」边界。
- 成功路由后的后续请求仍然粘性复用所选真实路由；只有在发生可恢复错误且另有候选可用时，故障转移才会改变路由。
- 当路由器拥有恢复权时，它会在下游 `dsh-llm-retry` 之前返回 retry；希望重试优先的部署应相应调整插件顺序。
- `score-weighted` 在不改变现有默认值的情况下提供负载感知策略。

## 测试

包测试覆盖运行态转换、score-weighted 选择、maxInflight 配置校验、QUOTA 故障转移到另一候选、全部不可用时交还原错误、显式未托管 provider 不拦截、并发 maxInflight 分散，以及每个源文件 100% 覆盖率。
