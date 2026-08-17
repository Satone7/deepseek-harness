# Agent Note: `/api` socket 来源的局域网可信网段栅栏

Status: implemented

[English](2026-08-17-lan-trusted-network-fence.md) | 中文

## 问题

`/api` 浏览器信任栅栏约束的是请求对自身的声明：`Host`、`Origin` 与 Fetch-Metadata 请求头。这防住了浏览器的两条 confused-deputy 路径（DNS rebinding、跨站读取），却让部署无法表达"我的局域网就是我的"：全接口绑定会把本机 LAN IP 字面量推导进 `trustedHosts`，于是普通方法应答任何能路由到端口的网络，而特权方法集（`settings.*`、`credentials.*`、`agentPreset.*` 的读取与名单写入、原生桌面操作、`llm.discoverModels`）仍钉在回环 `Host` 上。局域网运营者因此拿到一个半残的 GUI——每张设置卡片都以 `transport failure for /api/settings.describe: HTTP 403` 失败——CLI 又直接拒绝 `--host 0.0.0.0`，把运营者逼进 cordis.yml 绕过路径，且没有任何信任声明。

## 决策

信任连接的来源，而不是它的声明：`dsh-client-connection` 的新配置 `trustedNetworks`（`src/trusted-network.ts`）声明一组 IPv4 CIDR，其成员 socket 来源地址受该部署背书。TCP 来源地址无法在不完成握手回程的情况下伪造，因此这份声明针对的是机器，而不是请求头。这道门与既有请求头栅栏组合，而非取而代之：

- 声明网段后，每个 `/api` 请求与两条事件 upgrade 都必须来自回环或成员网段；其余来源在任何 Host 或 Origin 判定之前就被 403 拒绝，全接口绑定因此不再应答未受信网络。
- 成员（与回环）来源同时解除特权方法的回环钉定：可信局域网客户端与本机使用者一样可达整个配置面。放宽严格限于显式选择——未声明网段时，钉定逐字节等于旧的回环 `Host` 检查，`isTrustedSource` 恒真的回环臂不可能经非回环 `Host` 泄露特权访问。
- Host/Origin 栅栏对每个被接受的来源照常运行：可信局域网内部被重绑或跨站的浏览器仍被拒绝，因为声明背书的是连接的来处，不是该网络内某个页面可以请求什么。
- 桥接层把 socket 的 `remoteAddress` 作为类型化的 `FetchSource` 值传给 fetch 形态的处理器——这是同进程的传输层事实，绝不是客户端可伪造的请求头。
- 条目必须是主机位为零的规范 IPv4 CIDR（`192.168.100.5/24` 会让加载明确报错，任何 IPv6 或补零写法同样如此）；匹配会归一化 Node 的 `::ffff:` 映射形并做无符号比较（`&` 产出有符号 int32——朴素比较有符号数时会悄悄拒绝每个 ≥128.0.0.0 的网段，解析与成员测试把这一点钉死）。
- CLI 增加可重复的 `--trusted-network` flag，进入与 `--trusted-host` 相同的 `webRuntime` 交接面；`dsh web --host 0.0.0.0` 恰在至少声明一个网段时被接受——可达性请求与信任声明同进同出。

这仍不是按用户认证：已声明网线上的每个人都被接受。它是运营者把单用户部署圈定到自己可控的网络，对于会话本就运行 bash 的 harness，这才是诚实的契约。

## 考虑过的替代方案

- **放宽 `trustedHosts` 以覆盖特权方法。** 否决：Host 是客户端声明的请求头，特权面将向任何能写出 `Host: <已声明>` 的进程敞开——把旧钉定的可伪造性升格成了策略。
- **认证层（token/密码）。** 与之前一样推迟：局域网运营者的诉求是"我的网络表现得像我的键盘"，来源圈定恰好回答了它；token 的签发与轮换仍是对抗性网络下真正的产品面。
- **CLI 继续拒绝 `--host 0.0.0.0`。** 否决：运营者早已经 cordis.yml 达成全接口绑定，既无门也无声明；配对的 `--trusted-network` 要求把绕过路径转换成显式、可检查的契约。

## 后果

- `dsh --profile web --host 0.0.0.0 --trusted-network 192.168.100.0/24 --trusted-network 10.147.20.0/24` 向这两个网段与回环完整服务 GUI——设置、凭据、preset、原生选择器全部在内。
- 不声明即不变：回环部署与请求头栅栏下的局域网部署行为与从前完全一致，两种姿态都有测试钉定。
- 载体仍是 HTTP；栅栏没有任何 TLS 要求。改写 `Host` 的反向代理仍然需要为其发布的名字声明 `--trusted-host`，与请求头栅栏的契约一致。
- 专用通道与 interceptor 注册路径应用同一道来源门，任何 `/api` 家族的路由都不会独立于声明而放宽或收窄。
