# dsh-random-uuid

[English](README.md) | 中文

一个微小的、无依赖的 RFC 4122 version 4 UUID 生成器，供所有需要在浏览器非安全源（insecure origin）上生成 id 的包共享。

## 为什么 `crypto.randomUUID` 不够用

浏览器只在安全上下文中暴露 `crypto.randomUUID`——HTTPS 页面和 `localhost`。而 Web GUI 自身就会打印纯 HTTP 的 LAN URL（`dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.5:3080)`），从这些源加载的页面上没有 `randomUUID`，任何对它的调用都会抛出异常。`crypto.getRandomValues` 在所有浏览器源上都可用，Node 的 webcrypto 全局也提供它；本生成器只使用这一个原语。

```ts
import { randomUuid } from '@deepseek-ai/dsh-random-uuid'

const rpcId = randomUuid()
```

## 策略：浏览器可达的 id 一律经由本包生成

浏览器可达的代码绝不直接调用 `crypto.randomUUID`。仅运行于 Node 的代码可以继续使用它——安全上下文限制是浏览器行为。保持本包无依赖，使宿主侧包（`dsh-host-apiproxy`）和浏览器 UI 包（`dsh-client-ui-conversation`）都能使用它，而无需引入不相关的功能包。
