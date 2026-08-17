# Agent Note: 非安全源上的 RPC id

Status: implemented

[English](2026-08-17-insecure-origin-rpc-ids.md) | 中文

## 问题

浏览器将 `crypto.randomUUID` 限制在安全上下文中：它只在 HTTPS 页面和 `localhost` 上存在，其他地方一律没有。而 Web GUI 自身就会打印纯 HTTP 的 LAN URL（`dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.5:3080)`），从这类源加载的页面上没有 `randomUUID`——`AbstractApiClient.mintRpcId` 又直接调用它，于是浏览器发出的每一个 `/api` 请求在触网之前就抛出 `crypto.randomUUID is not a function`。整个 RPC 面（设置页也在内）在打印出的 LAN URL 所指的那类部署上完全不可用。另一个浏览器可达的调用点有同样缺陷：会话输入框的草稿附件 id。相比之下，`crypto.getRandomValues` 在所有浏览器源上都可用，Node 的 webcrypto 全局也提供它。

## 决策

浏览器可达的 id 一律经由共享的无依赖生成器 `randomUuid()`（新包 `@deepseek-ai/dsh-random-uuid`，`packages/util/random-uuid`）生成：仅用 `getRandomValues` 产出 RFC 4122 version 4，包形态镜像 util 组的 `dsh-brand`/`dsh-timeout`。四个调用点变更：`dsh-host-apiproxy` 的 `mintRpcId`（根因修复）、`dsh-client-ui-conversation` 输入框的 `browserDraftAttachment`、`dsh-llm` 的 `createMessage`（`INLINE_SAFE` 线路层，会内联进浏览器 bundle，其消息工厂因此浏览器可达），以及 connection 客户端自己的关联 id——其同功能的私有实现被新包取代。浏览器身份是平台模块：`PLATFORM_MODULES` 与 shell 的静态种子表共享同一实例，直接 import 与内联预构建线路层中残留的 require 都经由冻结模块表解析。纯宿主侧代码继续用 `crypto.randomUUID`——该限制是浏览器行为，与 Node 无关。

行为在单测层面钉住：将 `globalThis.crypto` 桩成只含 `getRandomValues` 的对象，跑完整的进程内协议往返；这个浏览器独有的条件无法由 Node 驱动的快照测试回放，其载体永远有 `randomUUID`。

## 备选方案

- **让 GUI 走 HTTPS。** 不作为修复手段：打印纯 HTTP LAN URL 是受支持的部署形态，在其之下依赖安全上下文 API 是代码缺陷，不是部署错误。TLS 对敌意网络的保密性仍有价值（经反向代理实现，webserver 没有 TLS 配置），对 localhost 部署则毫无影响。
- **`crypto.randomUUID?.() ?? fallback()`。** 否决：一个行为两条代码路径，而且按请求生成 id 的量级下，原生实现的性能优势毫无意义。

## 后果

- 完整 RPC 面在 GUI 可以加载的任何源上都可用，无论是否安全；设置页在纯 HTTP LAN 访问下不再报错。
- 浏览器可达代码生成 id 有了唯一归宿；新增调用方只需一次 import，而不是再复制一份位运算。
