# CLAUDE.local.md — Fork 开发规则（fork-only，不进上游；上游 .gitignore 本就忽略本文件）

本文件约束 fork 独有的开发纪律；仓库通用规则以 [AGENTS.md](AGENTS.md) 为准。冲突时本文件对 fork 决策优先。

## 第一宗旨：上游同步零阻碍

1. **加法优先**：fork 改动尽量新增文件；修改上游文件必须同时 ① 在 `fork-reports/SURFACES.md` 认领表登记（`node scripts/fork/sync-scope.mjs snapshot` 刷新，`check` 强制每个 M/D 被认领）② 带兜底测试。
2. **二次冲突规则**：同一上游文件在两次同步窗口都冲突 → 停止修补，向用户提出重构为 fork-only bundle/插件或上游化。
3. **受保护路径绝对不碰**：根 `package.json`、`pnpm-workspace.yaml`、`.github/**`、`CLAUDE.md`。fork 脚本一律住 `scripts/fork/`（`node scripts/fork/x.mjs` 直调），部署资产住 `deploy/`（上游均无这些目录，纯加法）。
4. **上游同步一律走 fork-upstream-sync SKILL**（`.agents/skills/fork-upstream-sync/SKILL.md`）：漂移检查 → `--no-ff` merge tag → SURFACES 命中面审查 → 最小充分门禁 → 插件 staging → `deploy/install.sh` → HTML 审计报告落盘。

## 第三方插件纪律（dsh-better-sidebar 等）

5. **精确 pin + lockfile**（`deploy/profiles/web/`），绝不 `^`，绝不自动升级。
6. **peer 兼容只信机器判定**（`node scripts/fork/peer-check.mjs`）：npm 预发布 semver 下 `^0.1.0-rc.x` 不容纳 `0.1.1-rc.y`（曾被人眼误判）。peer 形式不满足 ≠ 运行时不兼容——**升级与否由 `scripts/fork/plugin-stage.sh` staging 冒烟决定**，且与上游同步绑定在同一窗口。
7. 历史教训：插件惰性 chunk 依赖 dsh 的客户端模块系统全局量（如 `__DSH_MODULES__`），上游会改这类内部 API；staging 冒烟的 browser-probe 必须跑（服务端 RPC 全绿 ≠ 浏览器侧能用）。

## 部署与验证

8. **部署只走 `bash deploy/install.sh`**：冷装（隔离 store）→ 原子切换 profile → systemd 重启 → `scripts/fork/smoke.sh` 尾门禁 → 失败自动回滚（旧现场保留）。服务参数只在 `deploy/systemd/dsh-web.service` 改。
9. **服务存活检查用端口/HTTP 探测**，不用 `ps`（沙箱 PID namespace 看不到宿主进程）；staging/冷装不要在 `/tmp` 跑（noexec，node-pty 加载必失败）。
10. `pnpm run build` 的 client face 曾因「e2e 测试 import 宿主面 scaffold 但未进 tsconfig exclude」断过而无人发现——给 `apps/web/tests/` 加 import 时想一下面归属。

## 会话与文档

11. 上游 release notes 出现 `SESSION_FORMAT_VERSION` 变化 → deploy 前归档 `~/.dsh/sessions`（pre-release 无格式兼容承诺）。
12. fork 文档/审计报告进 `fork-reports/`（不进 doc-sync 翻译对），审计报告用中文 HTML。
