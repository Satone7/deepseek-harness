# `@deepseek-ai/dsh-llm-router`

[English](README.md) | 中文

函数插件，通过智能体循环的 `agent/request` waterfall 将虚拟提供方或模型路由映射到真实候选，并在 `agent/request-error` 上从提供方故障中恢复。它不包装 `ctx.llm.stream()`，也不实现协议适配器：`dsh-llm-pi-ai` / `dsh-llm-deepseek` 仍是实际提供方适配器，本插件只在适配器准备前改写提议的调用配置。

路由池的 `id` 就是虚拟路由。监听器先 `await next()` 取得机器当前的 `LlmCallConfig`，当 `provider` 或 `model` 等于某个池 id 时执行路由；两者分别命中不同池时以 provider 命中为准。被路由的配置保留所有其他字段（`maxTokens`、`stop` 以及未来的调用配置字段），只把 `provider` 与 `model` 替换为选中候选。未命中任何池的请求原样委托，因此省略 `pools` 或传空列表即为休眠姿态。

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

`weighted-random`（默认）按正整数 `weight`（默认 1）的相对比例随机选择候选。`round-robin` 按声明顺序每轮访问每个候选一次，跳过被配额/运行态过滤的候选，并保留完整池游标，使资格变化不会重置轮询周期；该策略忽略权重。`score-weighted` 将每个候选的基础 `weight` 乘以由可用性、负载与稳定性构成的 0..1 实时分数，再按比例抽样。所有策略都在新智能体首次提议虚拟路由时做一次选择；循环记录生效 header 后，后续请求复用所选真实路由，除非之后的提议改变它，或故障转移强制选择新路由。

候选可声明一个内置 `quotaProbe` 和可选的 `maxInflight` 上限。选择前，路由器先通过 `ctx.credentials` 解析 `apiKeyEnv`（未挂载该 seam 时回退到启动环境快照），查询提供方，再移除配额耗尽的候选：百分比探测使用 `percentage < maxPercentage`（默认 100），`deepseek-balance` 使用 `balance > minBalance`（默认 0）。结果按候选、密钥与提供方缓存，TTL 为 `ttlSeconds`（默认 300）；刷新失败时若存在旧快照则返回旧值。凭证缺失，或探测失败且无缓存快照的候选会被排除；池中无任何合格候选时，请求以 `QUOTA` 失败。路由器还会排除处于冷却中、熔断打开或已达 `maxInflight` 的候选。

配置 schema 校验池/候选 id、provider、model、权重、`maxInflight`、策略、探测类型、凭证引用、阈值、TTL 以及非空候选列表。`apply` 会再次检查同样的不变量，使直接调用方在插件加载时同样响亮失败；重复项与空 id 绝不会被静默跳过。

M2 运行态按候选维护。`agent/request-error` 将 `QUOTA` 标记为较长冷却，将 `RATE_LIMIT` 按 `Retry-After` 或默认冷却处理，并将 `SERVER`/`TIMEOUT` 计入熔断计数。当至少还有另一个候选可用时，路由器返回 `{ kind: 'retry' }`，下一次 `agent/request` 会被强制回到同一虚拟池并跳过失败候选。当所有候选都不可用时，路由器调用 `next()`，把原始失败或下游重试策略交还处理，因此不会制造无界重试。成功的 `assistant/message` 会释放 inflight 预留并重置熔断状态。

## 持久化与可观测性

当挂载 `storage-domain` 数据形式（`ctx.storage.domain` / `ctx.storageDomain`）时，路由器会打开名为 `llm_router` 的领域，使用 `states` 表持久化每个候选的冷却、熔断、inflight 与最后错误。写入通过 storage-domain 的写链串行化，并在路由与故障转移路径上等待；持久化失败只记录日志，不会阻断请求路由。插件启动时会恢复仍存在候选的持久化状态；未知或损坏的行会被忽略。如果存储不可用或打开失败，路由器会记录警告并继续使用内存状态，保持 M2 行为不变。

路由、故障转移与全部不可用决策也会写入插件日志（`ctx.logger`）以便观测。

路由器注册 `llm-router` settings namespace（重启后生效），并在 Web 设置 **插件** 页提供 **插件配置** 卡片。该卡片以经过校验的 JSON 编辑路由 `pools` 文档；修改写入用户设置层，重启后生效。

## Model Experience

### 请求路由与配额探测

#### 模型看到什么

路由与配额决策对模型不可见。模型在所选真实 provider/model 下收到相同的请求内容；循环像记录任何显式选择一样，把生效的 provider/model 写入持久化的 `request/header`。当所有候选都因配额被排除时，轮次错误作为带错误码的请求失败对模型可见。

#### Token 影响

路由与配额探测不增加提示词 token，也不增加响应 token 计费。实际 token 计费由所选 provider/model 决定，可能与其他候选的计费或分词不同。

#### KV Cache 影响

provider 与 model 是缓存身份字段。首次被路由的请求改变了生效路由，因此也改变缓存身份；之后复用已记录真实路由的请求保持前缀稳定的缓存行为，而后来的路由变更与显式修改 provider/model 一样使复用失效。

## Known Limitations and Deferred Work

- **持久化依赖 storage-domain** — 挂载 `storage-domain` 时会持久化冷却、熔断、inflight 与最后错误；未挂载时回退为内存状态。尚未实现跨进程实时同步：各进程启动时从共享介质刷新，写入采用 last-writer-wins。
- **仅主对话请求** — 直接使用 `ctx.llm.stream()` 的辅助 LLM 调用不经过 `agent/request`，不会被路由。
- **成功后粘滞** — 成功路由后的后续请求复用已记录的真实路由；只有在 `agent/request-error` 遇到可恢复失败且另有候选可用时，故障转移才会重新路由。
- **仅内置探测** — 尚未实现通用 `http`/`script` 探测、按提供方的缓存失效与多进程配额一致性。
- **Round-robin 游标为进程内** — 游标不持久化，也未实现平滑加权轮询。
- **池 id 与 provider/model 共用命名空间** — 与池 id 同名的真实 model 或 provider 会被视为虚拟路由；部署方自行规避该冲突。
