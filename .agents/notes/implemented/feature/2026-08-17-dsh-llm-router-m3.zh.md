# Agent Note: dsh-llm-router M3 持久化与可观测性

Status: implemented

[English](2026-08-17-dsh-llm-router-m3.md) | 中文

## 问题

M2 只把冷却、熔断、inflight 与最后错误保存在进程内存中。重启后会丢失故障/冷却信息，运维也没有内置的路由决策或故障转移可见性。

## 决策

M3 为 `@deepseek-ai/dsh-llm-router` 增加可选持久化与日志，不改变 M2 路由语义。

- 新增 `llm_router` storage-domain（`states` 表），持久化每个候选的 `inflight`、`consecutiveFailures`、`circuit`、`cooldownUntil` 与 `lastError`。
- 当挂载 `ctx.storageDomain` / `ctx.storage.domain` 时，路由器在 `apply` 期间打开领域，恢复仍存在候选的状态，并在路由、故障转移、半开转换与成功时通过 storage-domain 写链写入。未知或损坏的行会被忽略。
- 如果存储不可用或打开失败，路由器记录警告并继续使用内存状态，因此现有 M0-M2 部署无需改动即可继续工作。
- 路由、故障转移与全部不可用决策通过 `ctx.logger` 记录，便于观测。
- 路由器注册 `llm-router` settings namespace（重启后生效），并提供 Web 设置 **插件** 卡片。该卡片以经过校验的 JSON 编辑路由 `pools`。

## 曾考虑的替代方案

- **强制要求 storage-domain。** 这会破坏未挂载存储表单的现有用户，也不符合插件的可选附加姿态。
- **只持久化冷却/熔断。** inflight 也是 M2 运行态的一部分，对重启可见性有价值；尽管崩溃进程可能留下陈旧计数直到其自然衰减。
- **为每次路由发送自定义 session event。** 日志更轻量，也避免为内部路由遥测扩展 session event 词汇。
- **为 pools/candidates 构建深层嵌套表单。** 对于结构化路由器配置，JSON 文档编辑器更简单，并且在保存时仍会经过 schema 校验。

## 后果

- 挂载存储后，冷却/熔断/最后错误可在重启后保留。inflight 也会持久化；崩溃进程留下的陈旧 inflight 是已知限制。
- 多进程一致性为尽力而为：各进程启动时从共享介质刷新，写入采用 last-writer-wins。未实现跨进程实时事件同步。
- 持久化写入失败只记录日志，不会阻断请求路由；当前进程仍以内存状态为准。
- 包现在将 `@deepseek-ai/dsh-storage-domain` 作为可选持久化路径的 peer 依赖，并使用 `zod` 定义持久化 schema。

## 测试

包测试覆盖状态 key/序列化辅助函数、重启后恢复故障转移冷却、完成前 inflight 持久化与成功后清零、跳过未知/损坏行、半开转换持久化、持久化写入失败容错、存储打开失败回退、settings namespace 注册，以及每个源文件 100% 覆盖率。settings-plugins 客户端测试覆盖 JSON 文本域卡片、JSON 字段解析与卡片注册。
