# dsh-random-uuid

English | [中文](README.zh.md)

A tiny, dependency-free RFC 4122 version 4 UUID generator shared by every package whose ids must mint on a browser insecure origin.

## Why `crypto.randomUUID` is not enough

Browsers expose `crypto.randomUUID` only in secure contexts — HTTPS pages and `localhost`. The Web GUI itself prints plain-HTTP LAN URLs (`dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.5:3080)`), so pages loaded from those origins have no `randomUUID` and any call to it throws. `crypto.getRandomValues` is exposed on every browser origin and by Node's webcrypto global; it is the one primitive this generator uses.

```ts
import { randomUuid } from '@deepseek-ai/dsh-random-uuid'

const rpcId = randomUuid()
```

## Policy: mint browser-reachable ids through this package

Browser-reachable code never calls `crypto.randomUUID` directly. Node-only code may keep using it — the secure-context gate is a browser behavior. Keeping this package dependency-free lets both host packages (`dsh-host-apiproxy`) and browser UI packages (`dsh-client-ui-conversation`) reach it without pulling an unrelated capability package.
