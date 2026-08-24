# Fork 稳定更新机制设计 —— 观点落盘

> 日期：2026-08-22（2026-08-24 增补实施记录，见 §8）
> 作者：主 agent 分析（含与 glm-5.3 两轮讨论收敛，分歧记录见 §5）
> 适用范围：Satone7/deepseek-harness fork（唯一维护者）
> 目标：在持续跟踪 upstream 更新的前提下，保证 fork 自有 feat 与第三方插件始终正常工作
> 状态：**已实施（2026-08-24）**——SKILL/脚本/规则/部署收编全部落地，并完成首次同步窗口（rc.1→rc.2）；入口见 fork-reports/INDEX.md「机制入口」

---

## 0. 事实基线（2026-08-22 实测）

| # | 事实 | 证据 |
|---|------|------|
| F1 | fork master 落后 upstream 708 个 commit；上次同步 2026-08-21（rc.7→0.1.1-rc.1，448 commits）；upstream 已发布 0.1.1-rc.2 | `git rev-list --count origin/master..upstream/master` |
| F2 | 线上服务（0.0.0.0:3080，systemd user 服务 dsh-web）**一直在运行**，版本 0.1.1-rc.1；终端插件服务端全链路健康（client 注入 / chunk 200 / node-pty ok / WS+PTY echo 通过） | 端口探测 + 分层探测链实测 |
| F3 | 信任边界不一致（实时复现）：`trustedNetworks=["10.147.20.0/24"]`；从 eth0（172.29.15.156）源访问 `/api/session.list` → **403**，而 `/sidebar/api/terminal.deps` → **200**（插件路由只做 Host 头校验，不过来源栅栏，PTY 同样可达）；从可信源 10.147.20.97 访问 /api 通过 | curl `--interface` 绑定源地址实测 |
| F4 | 依赖不可复现：`@deepseek-ai/dsh-token-cost` 0.2.1（`private: true`，未发布 npm）依赖 `file:/home/pren/projects/deepseek-harness/review-dsh-token-cost/*.tgz`，**该路径已不存在**；现有 node_modules 是 2026-08-18 安装的暂态，全新 `pnpm install` 必失败 | `ls` 目录不存在 + profile package.json 实读 |
| F5 | 第三方插件滞后：dsh-better-sidebar 已装 0.12.3（2026-08-16 发布），npm 最新 0.15.2（2026-08-22 发布）；该插件日更 1–3 版；0.15.2 peerDeps 要求 `@deepseek-ai/dsh-*@^0.1.0-rc.8`（~~fork 的 0.1.1-rc.1 满足~~ **订正（2026-08-24）**：semver 机器判定**不满足**——npm 预发布语义下跨 patch 元组的 `^rc` 范围不容纳 0.1.1-rc.x；本条人眼判定错误正是「绝不人眼判」原则的第一个反例） | npm registry 查询 + 本地 package.json + semver.satisfies 实测 |
| F6 | 未合并分支 `feat/dsh-llm-router`（2 commits，基于旧 base）持续漂移；经核查上游 `packages/llm` **无 router 等价物**，该 feat 是独有价值 | git log + upstream 全量提交核查 |
| F7 | 沙箱/容器陷阱：`ps` 在隔离 PID namespace 下看不到宿主机进程（曾因此误判"服务没在跑"）；**服务存活检查必须用端口/HTTP 探测** | bwrap `--unshare-pid` 实测 |
| F8 | 现有同步机制：`fork-reports/` 手工审计 HTML（仅 2026-08-21 一条），纯手工触发，无漂移告警、无自动化验证 | fork-reports/INDEX.md |

---

## 1. 根因（机制层，与"人是否勤快"无关）

- **R1 漂移正反馈环**：同步成本随漂移量超线性增长（冲突面、审计面、peer 范围漂移叠加），"越落后越痛苦 → 越拖延 → 越落后"，必然收敛到"崩一次再补课"。
- **R2 fork delta 不是一等公民**：fork 改动散在 master 历史里，没有机器可读的"我们改了上游哪些面"清单；审计 HTML 是证据不是检查，不能跑、不能变红、不能防回归。
- **R3 三向交互面漂移无映射**：上游重构 ↔ fork patch；fork 安全契约 ↔ 第三方插件路由（F3 的绕过即此）；插件 peer 范围 ↔ dsh 版本（F5）。
- **R4 部署不可复现**：profile（依赖清单 + lockfile + node_modules）在仓库外、不受版本控制、从不冷装验证；`file:` 悬空依赖靠旧 node_modules 续命（F4）。
- **R5 失败靠人体症状发现**：服务状态、插件新版、"该升还是升了会坏"都没有信号；403 与"插件坏了"被混为一谈——没有分层健康检查把"服务存活/网络路径/插件链路/权限"拆开。
- **R6 WIP 分支无生命周期**：未决分支每天升值（F6）。
- **R7 最贵认知工作放在最坏时机**：单人维护者的注意力被要求"在不可预测的时间点对 448 个 commit 做全量人工语义审计"。

---

## 2. 设计原则（三句话）

1. **把记忆变成信号**：一切"该做而没做"的事必须自己产生告警（issue / 变红的检查），不依赖人想起。
2. **把审计变成检查**：fork 的每个交互面都要有一条可执行测试兜底；人工审计只保留给测试覆盖不了的语义判断，且范围由机器预先收窄。
3. **最小化并固化 fork delta**：fork 改动尽量"加文件"而不是"改上游文件"（加法永不冲突）；无法避免的 patch 要有 SURFACES 清单 + 测试 + rerere 记忆。

---

## 3. 具体机制：五大支柱

### 支柱 A —— 上游同步流水线

- **同步粒度：按 release tag，不追 master HEAD**。tag 是上游 CI 门禁过的点，也是插件生态 peer 范围瞄准的点；每次变更集有界、有 release notes 可依。紧急修复用 cherry-pick（保留上游引用，后续合并自然消解）。
- **漂移探测是每日的**——把"看"和"合"解耦。
- **merge-forward，不 rebase 已推送历史**（fork master 是公开历史；merge 决议留档，rerere 复用决议）。rebase 只用于未推送 WIP。
- **runbook（写进 fork-reports/RUNBOOK.md）**：
  1. `git fetch upstream --tags`
  2. 从 master 开 `sync/upstream-v<tag>` 分支
  3. `git merge <tag>`（rerere 复用决议；只重点审 SURFACES 命中文件 + release notes）
  4. `pnpm install && typecheck && test && build`
  5. `scripts/fork/smoke.sh --ephemeral`（无头临时实例）
  6. push + PR；合并后 `deploy/install.sh`（同窗口处理插件升级，见支柱 C）
- **触发（GitHub Actions，fork-only workflow，加法原则）**：
  - `fork-drift.yml`（每日 cron）：`git ls-remote upstream` 数落后量 + 最新 tag；`npm view` 对比插件 pin 与 peer 范围（用 pnpm 同款 semver resolver 机器判定，rc prerelease 语义绝不人眼判）；结果写进**滚动更新的单一 drift issue**（防告警疲劳）。阈值：落后 ≥1 个 release tag 即黄牌。
  - `fork-sync-prep.yml`（检测到新 tag）：自动试合并 → 全量门禁 → 计算 `git diff --name-only vOld..vNew` 与 SURFACES 路径交集 → 绿则开"ready-to-review"同步 PR，红则把失败摘要贴进 drift issue。**这是杠杆最大的一步：把同步从工艺活变成审查一份准备好的 PR。**
  - CI registry 用官方源（runner 在海外，可复现性最强）；本地开发保持 npmmirror 不受影响。

### 支柱 B —— fork feat 保护：SURFACES 清单 + 边界测试

- **`fork-reports/SURFACES.md`**（由 sync 脚本生成/维护，产物进 git，漂移在 diff 里可见）：

  | feature | 触碰的上游面 | 兜底测试 |
  |---|---|---|
  | feat(connection) trustedNetworks | dsh-client-connection 源码、web CLI flags、路由/upgrade 注册层 | 栅栏正反向测试（见下） |
  | web 设置页版本行 | settings 页 | snapshot |
  | dsh-base 默认挂 claude-code | dsh-base cordis.yml | 配置解析测试 |
  | apiproxy RPC id 修复 | apiproxy | 回归测试 |
  | feat/dsh-llm-router（未合并） | packages/llm、web profile | 合入后补 |

- **每个 feat 一条可执行边界测试**（进对应 package 的常规 vitest，吃现有 CI）。最重要的：栅栏正反向——非成员源访问 `/api` 与**任意插件注册路由/upgrade** → 403/拒绝（这条会当场抓住 F3 的绕过）；成员源与回环放行；特权方法解锁语义。测试锚定需求语义（回环 + 成员网段），不锚实现细节，避免上游正常重构无谓变红。
- **信任边界收口（本周项，一石二鸟）**：在 fork 自有文件 `packages/bundle/web-app/src/index.ts` 的 `resolveLanTrust` 中，当声明 `trustedNetworks` 时把 `lanAddresses` 过滤为成员网段地址。效果：插件（消费 `webRuntime.trustedHosts` 做 Host 校验）自动拒绝 eth0 来源的 /sidebar 与 WS；`__DSH_WEB_TRUST__` 注入与浏览器侧信任判定同步收敛；启动打印只列可信入口（F3 的绕过关闭，入口误导消除）。负向测试三件套：eth0 → /sidebar 403 + WS 拒绝；声明网段与所有接口不相交时不打印 LAN 行且不报错。
- **二次冲突触发规则**：某个 feat 第二次在同步中冲突 → 插件化（搬进 fork-only bundle）或上游化。
- **上游化候选（优先做）**：① apiproxy RPC id 修复（fork commit `16fa8f2f6d`，自包含、带测试、抽出了 `packages/util/random-uuid`——上游喜欢的 PR 形状），作为第一个 upstream PR；② trustedNetworks 栅栏本身（issue 先行探设计共识，PR 设计里带"fence 可复用、插件不拷贝"考量）。
- **systemd 服务参数必须固化**：`EnvironmentFile` 或单元内显式写死 `--host 0.0.0.0 --trusted-network ...`，防止"手工验证带参数、重启后裸起"的行为漂移；`Restart=on-failure` + `loginctl enable-linger`。

### 支柱 C —— 第三方插件跟踪

- **精确 pin + lockfile，绝不自动升级 profile**（部署变更必须显式且过冒烟）。
- **"该升了"**：每日 `npm view` 对比 + 分类表（当前已是 / 可升级且 peer 满足 / 被阻塞）进 drift issue。日更 1–3 版不是问题：信号每日汇总一次，人只在同步窗口看。
- **"升了会坏"两层检测**：① peer 范围 vs fork 当前 dsh 版本的机器判定（semver resolver）；② **staging 冒烟** `scripts/fork/plugin-stage.sh`：新插件版本 + 当前 fork 构建创建一次性 profile，无头起 web，跑完整探测链（注入 → chunk → deps → WS+PTY echo）。本地/CI 两用。GUI 渲染级深度不可测，明确接受——断点几乎总在服务端链路。
- **节奏绑定**：插件升级固定在每个上游同步窗口内做（sync → rebuild → plugin bump → stage → deploy 一个窗口完成）；例外只有安全修复或当前版本损坏。

### 支柱 D —— 验证门禁：`scripts/fork/smoke.sh`

覆盖清单（每条对应一次已实际发生的失败模式）：

1. 服务存活：**端口/HTTP 探测**（不用 ps——F7 教训），systemd active
2. 注入链：`/` 含 `/plugins/dsh-better-sidebar/client.js`；该文件 200；`/sidebar/bundle/terminal.js` 200
3. `/sidebar/api/terminal.deps` → node-pty ok（防 native 模块随环境腐烂）
4. 栅栏正向：`curl --interface 10.147.20.97` 下 /api → 非 403（本机绑定源地址即可，无需第二台机器）
5. 栅栏负向：`curl --interface 172.29.15.156` 下 /api 与 /sidebar 均 403、WS upgrade 被拒（修 F3 前这条会红——正是它该红的）
6. 终端 E2E：WS 连 `/sidebar/ws/terminal`，`echo smoke-$$` 往返断言
7. profile 冷装（临时目录 `pnpm install --frozen-lockfile`，**禁用本机 store 缓存**——frozen-lockfile 不够，缓存会掩盖 registry 差异）——防 `file:` 腐烂
8. 版本一致性：服务报告的版本 == master package version

挂载点分工：

| 位置 | 跑什么 |
|---|---|
| CI（push/PR/定时） | 1–3、6–8 回环版 + 栅栏判定函数单元级正反向 |
| 本地 systemd timer（`dsh-health.timer`，daily + Persistent） | 真实部署全量；失败先自动重启一次再复跑，仍失败 `gh issue create` 告警 |
| `deploy/install.sh` 尾部 | 必跑；不过即回滚（`mv` 保旧 profile 而非 `rm`，保留现场对比诊断） |
| pre-push | 触碰面匹配：connection/deploy 有改动时强制栅栏测试 + 临时实例冒烟 |

冒烟每层失败要报"断在哪一环"（注入 / client.js / chunk / deps / WS+PTY 分开报错），否则现场排查成本远高于多写几行分支输出。

### 支柱 E —— 部署可复现：`deploy/` 收编

```
deploy/
  profiles/web/package.json     # 精确 pin（无 ^），与真实 profile 同源
  profiles/web/pnpm-lock.yaml
  profiles/web/vendor/          # 收编的私有包（dsh-token-cost 0.2.1）
  systemd/dsh-web.service       # unit 文件真身（含 EnvironmentFile）
  install.sh                    # 重建 profile → 装 unit → 重启 → 冒烟
```

- **dsh-token-cost 收编**（本周）：从现有 node_modules（`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-token-cost`，仍存在）抢救进 `deploy/profiles/web/vendor/`，profile 依赖改 `file:vendor/dsh-token-cost`（仓库内相对路径，永不再烂），lockfile 固化 integrity。唯一不可接受的状态是维持悬空 `file:` 引用。
- **dsh-better-sidebar**：外部发布的插件，版本 pin + lockfile 固化即可，不 vendor 源码；该决策在 deploy 收编时显式记录。
- **install.sh 流程**：tempdir 冷装验证 → 原子切换真实 profile（rsync）→ 装 unit + daemon-reload + enable --now → smoke 尾部门禁，不过回滚。

---

## 4. 落地顺序（修正版：已删除"起服务"项——服务一直在跑，F2）

| 时限 | 行动 | 级别 |
|---|---|---|
| 今天 | 写 `scripts/fork/smoke.sh` v1（探测链 1–8 中回环可跑的；把本次已实测通过的链路固化） | 必须 |
| 本周 | ① `resolveLanTrust` 网段过滤 + 启动打印只列可信地址（同一 PR）+ 负向测试三件套 ② `deploy/` 收编 + token-cost 抢救 + 冷装验证 ③ `fork-drift.yml` + drift issue ④ SURFACES.md 脚本生成 ⑤ `16fa8f2f6d` 整理为上游 PR #1 ⑥ llm-router 决策（合入 or 归档，一周内） | 必须/应该 |
| 本月 | ⑦ trustedNetworks 上游 issue + PR（含 fence-as-service 设计）⑧ `webRuntime` 暴露统一信任判定，插件从"拷贝栅栏"改"消费服务"（拷贝漂移已实际发生，F3 是证据）⑨ llm-router 上游 issue 探兴趣 ⑩ 本地 health timer + 告警 | 应该/可选 |
| 长期 | ⑪ 咽喉层统一判定作为 ⑦⑧ 落地后的终态形态 ⑫ fork-reports 常态化审计节奏（每次 upstream merge 后自动生成骨架，人只补语义注记） | 可选/应该 |

---

## 5. 与 glm-5.3 的讨论收敛记录

两轮讨论（glm-5.3 独立分析 → 主 agent 反驳 → 逐点回应）。采纳清单：

- 同步成本超线性 → 漂移探测每日、合并按 tag；
- "先恢复/验证、后动依赖"的顺序（冷装会踩 `file:` 雷）；
- systemd 参数 EnvironmentFile 固化 + Restart=on-failure + linger；
- 冷装禁用 store 缓存；回滚用 mv 不 rm；smoke 分层报错；
- 上游 `packages/llm` 无 router 等价物（glm-5.3 核查）→ llm-router 是独有价值；
- 官方 registry 用于 CI，本地保持镜像；
- SURFACES 生成物进 git；drift 用滚动单 issue。

**唯一实质分歧**（不影响本周行动）：

- 主 agent：`resolveLanTrust` 过滤是终态。
- glm-5.3：过滤是止血，插件各自拷贝栅栏是模式级漂移（sidebar 的 trust-fence 是从 dsh-client-connection 拷贝且已丢失 CIDR 层），长期应由 `webRuntime` 暴露 fence-as-service 让插件消费而非拷贝。
- 调和：本周完全按过滤修法；分歧只影响本月是否做第 ⑧ 项。若不再增加带路由的插件，⑧ 可砍，但 SURFACES.md 必须写明"新增插件必须自带栅栏"约束。

---

## 6. 风险与取舍

| 步骤 | 代价 | 主要风险 | 单人维护者结论 |
|---|---|---|---|
| smoke.sh | 半天 | 无 | 必须（否则每次失败靠人体症状） |
| resolveLanTrust 过滤 | 半天 + 测试 | 消费方行为需逐一验证（已核查三个消费方一致） | 必须（关绕过 + 修入口，一石二鸟） |
| deploy/ 收编 + 冷装 | 一次性半天 + 每次改 profile 多一步提交 | 改插件习惯从"顺手 pnpm add"变"改 manifest 跑脚本" | 必须（否则下次 install 必炸） |
| 每日 drift issue | 建一次 + 极少 Actions 分钟 | 告警疲劳 → 滚动单 issue + 阈值分级 | 必须（把记忆变信号的最低成本实现） |
| fork-sync-prep 试合并 PR | 中等搭建 | flaky 误报（加重试/初期 allow-failure）；绿灯虚假安全感（SURFACES 交集 + 人工审命中面对冲） | 应该（同步成本从工艺降为审查的最大杠杆） |
| 上游化 fork feat | PR + 评审往返 | 被拒 → 继续本地维护，无损失 | 应该（apiproxy 优先，最稳） |
| 栅栏 upstream PR | 设计讨论往返 | config 表达返工 → issue 先行 | 可选但高价值 |
| 本地 health timer | 低 | 机器关机即停（可接受）；告警依赖 gh 出网 | 应该（运行态唯一守护） |
| llm-router 处置 | 合入数小时 / 归档十分钟 | 拖延即每日升值 | 必须二选一，限一周 |

**可以不做的**：按 commit 同步、rebase 工作流、插件自动升级、GUI/xterm 渲染级 E2E、跨源负向测试进纯回环 CI（用包内单元测试 + 本地 timer 覆盖）、fork 版本号后缀（会干扰 peer 范围兼容性，fork 身份放在 git/fork-reports 即可）。

**不能不做的最小集**（缺任何一环链条即断）：每日漂移信号 → 按 tag 的 merge-forward 同步 + 试合并 PR + rerere → 五个 feat 的边界测试（尤其栅栏正反向）→ deploy/ 版本化 profile + 冷装 → token-cost 收编 → smoke + 本地 timer + linger/Restart → 栅栏绕过关闭 → llm-router 一周内落地或归档。

---

## 7. 机制有效的判定标准（三个"不再发生"）

1. **同步不再积压**：任何时刻落后 ≤ 1 个 upstream release tag；每次同步由"准备好的 PR"驱动，人工只审 SURFACES 命中面 + 冲突 + release notes。
2. **feat 不静默坏**：每次上游合并后门禁全绿（typecheck/test/build/冒烟）；任何 fork 交互面回归都有一条会变红的测试当场抓住。
3. **插件不静默坏**：每日对比表显示每个插件"当前版本 / 最新 / peer 兼容性"；升级永远走 staging 冒烟；线上服务由健康 timer 守护，挂了自动重启并告警。

这套机制把三个跟踪目标各接上一个不会遗忘的信号源：上游靠 drift issue + 准备好的同步 PR，fork feat 靠 SURFACES 清单 + 边界测试，第三方插件靠 pin + peer 机器判定 + staging 冒烟；部署本身靠 deploy/ 冷装 + 每日健康 timer 兜底。维护者的注意力只花在机器判定不了的地方：冲突的语义取舍和命中面的审查。

---

## 8. 实施记录（2026-08-24 增补）

同一天（2026-08-24）在用户批准的落地顺序下全部实施，并完成首次同步窗口。落地物与文档原案的差异：

**已落地（与原案一致）**

- 支柱 D 冒烟：`scripts/fork/smoke.sh`（8 层→实现为 L1–L7 共 11 个断言，分层报错）；`scripts/fork/browser-probe.mjs` 无头浏览器探针（原案未单列，staging 与故障定位共用）。
- 支柱 E 部署收编：`deploy/profiles/web/`（manifest + lockfile + vendored dsh-token-cost）+ `deploy/systemd/` + `install.sh`（冷装→原子切换→重启→冒烟→回滚）。**实现中新发现两颗雷**：pnpm 10 默认拦截 node-pty 构建脚本（放行写入 workspace yaml）；`/tmp` noexec 挂载使原生模块加载必败（staging 移入 `~/.dsh`）。
- 支柱 B：`resolveLanTrust` 网段过滤（收口 F3）+ 负向测试三件套；SURFACES 清单落地为 `fork-reports/SURFACES.md`。
- 支柱 C：`scripts/fork/peer-check.mjs`（semver 机器判定）+ `scripts/fork/plugin-stage.sh`（staging 冒烟，含「profile 必须是 DSH_HOME 下真实目录」的实测教训）。
- 同步 SKILL：`.agents/skills/fork-upstream-sync/SKILL.md`（漂移→merge→交集审查→门禁→staging→部署→HTML 审计）。
- 开发规则：`CLAUDE.local.md`（上游 gitignore 忽略、force-add、每次会话自动加载）。

**与原案的差异（均经用户确认）**

- SURFACES 为**计算式**（`sync-scope.mjs` 从 merge-base diff 生成，认领表强制覆盖每个 M/D，`check` 为门禁）而非手维护清单——glm-5.3 复审意见被采纳。
- CI workflows（fork-drift / fork-sync-prep）**未建**：本轮用户选择会话驱动（读 SKILL 执行）；Actions 自动化为可选项留在 INDEX 遗留清单。
- 插件不兼容兜底：用户选择**保持 0.1.1-rc.x 等生态跟进**（不回退、不打本地补丁）；实测 0.15.2 运行时兼容，无需兜底。
- 本轮直接完成 rc.2 完整同步并部署（原案「dry-run 验证」升级为真实验收）。

**首次同步窗口（rc.1→rc.2）验证了机制**：冲突 4 处全部落在 sync-scope 预测热点（`client/connection`）；门禁全绿（typecheck/build/530 测试/check）；staging 绿；部署冒烟 7 层全绿；rerere 已记录决议。审计见 [2026-08-24 报告](2026-08-24-upstream-0.1.1-rc.1-to-0.1.1-rc.2.html)。

**同窗口附带修复**（终端/预览失效的完整因果链见审计报告 §1）：插件升级 0.12.3→0.15.2；fork 自引入的 client-face 构建断裂（smoke-real.e2e.ts import scaffold 未进 tsconfig exclude）。
