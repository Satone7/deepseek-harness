---
name: fork-upstream-sync
description: Use when syncing this fork with upstream deepseek-harness, checking upstream/plugin drift, upgrading third-party dsh plugins, or auditing fork-vs-upstream compatibility（上游同步、同步 upstream、漂移检查、插件兼容排查、插件升级、dsh-better-sidebar 升级）. Covers the full sync window: drift check, merge, review focus, gates, plugin staging, deploy, audit report.
---

# Fork 上游同步窗口（fork-only 流程，勿上游化）

本 fork 的唯一同步通道。目标：**同步零积压、feat 不静默坏、插件不静默坏**。所有命令从仓库根执行；`node --import tsx` 直调 fork 脚本，不碰根 package.json。

## 0. 前置事实

- fork delta 的事实源是 `fork-reports/SURFACES.md`（`scripts/fork/sync-scope.mjs snapshot` 生成路径清单，认领表手工维护）。
- 线上服务：systemd user 服务 `dsh-web`（0.0.0.0:3080），跑仓库构建产物（全局 `dsh` 软链 `apps/cli/lib`）；插件与 token-cost 在 profile（`deploy/profiles/web/` 是清单真身，`~/.dsh/profiles/web/` 是 `deploy/install.sh` 的产物）。
- 部署/回滚一律走 `bash deploy/install.sh`（冷装 → 原子切换 → 重启 → 冒烟门禁 → 失败自动回滚，旧现场保留在 `~/.dsh/.deploy-backups/`）。

## 1. 漂移检查（日常/同步窗口开头）

```sh
git fetch upstream --tags
git rev-list --count HEAD..upstream/master        # 落后量
git tag --sort=-creatordate | head -3             # 最新 tag
node scripts/fork/peer-check.mjs                  # 插件 pin vs npm 最新 + peer 机器判定
```

peer 判定规则见脚本尾部说明：npm 预发布 semver 下 `^0.1.0-rc.x` 不容纳 `0.1.1-rc.y`（patch 元组不同）是**正确行为**；peer 形式不满足 ≠ 运行时不兼容，升级与否只由第 5 步 staging 冒烟定。

## 2. 合并

```sh
git config rerere.enabled true                    # 一次性；决议记忆复用
git switch -c sync/upstream-<tag> master
git merge --no-ff <tag>                           # 用户规则：merge 一律 --no-ff
```

冲突重点（`node scripts/fork/sync-scope.mjs diff <oldTag> <newTag>` 给出完整命中清单）：
- 命中认领面的文件：逐个对照 SURFACES 认领表里该 feature 的兜底测试；
- **认领面在上游消失**（重命名/删除告警）：上游动了 fork 的命门，逐条核实后更新认领表 globs；
- 历史热点：`packages/client/connection`（trustedNetworks 是 fork 独有，上游持续在改 Host 栅栏）、`packages/bundle/web-app/src/index.ts`（上游改过 index 注入表机制）。
- 同一文件**第二次**同步冲突 → 停下来向用户提出插件化（fork-only bundle/插件）重构，不硬解。**本 fork 不向上游提交 PR**（2026-08-24 用户确认的永久策略）——上游化不是选项，所有 fork 改动保持 fork-local。

## 3. 门禁（按最小充分集，不盲跑全量）

```sh
pnpm run typecheck && pnpm run build
pnpm exec vitest run bundle/web-app client/connection bundle/base host/apiproxy   # SURFACES 命中面的兜底测试
node scripts/fork/sync-scope.mjs snapshot && node scripts/fork/sync-scope.mjs check
```

`check` 不过（M/D 未认领 / 受保护路径 diff）时：新文件加认领或还原；受保护路径（根 package.json、pnpm-workspace.yaml、.github/**、CLAUDE.md）的改动一律转移到 `scripts/fork/`、`deploy/` 等加法路径。

release notes 检查：出现 `SESSION_FORMAT_VERSION` 变化 → 部署前先归档 `~/.dsh/sessions`（pre-release 无格式兼容承诺）。

## 4. 插件窗口（与同步绑定，一个窗口完成）

```sh
node scripts/fork/peer-check.mjs                          # 候选版本
bash scripts/fork/plugin-stage.sh dsh-better-sidebar <新版本>   # staging 冒烟（不动线上）
```

- 绿：更新 `deploy/profiles/web/package.json` pin → 在该目录 `pnpm install --lockfile-only`（或装完回填 lockfile）→ 随第 6 步一起部署；
- 红：保持 pin，在审计报告记录「等生态跟进」，下次窗口再试。

## 5. 合入 master 与部署

```sh
# 门禁全绿后（PR 或用户确认直接合）
git switch master && git merge --no-ff sync/upstream-<tag>
pnpm run build                                            # 部署前确保构建产物最新
bash deploy/install.sh                                    # 冷装+切换+重启+冒烟，失败自动回滚
```

## 6. 落盘（每个窗口必做）

1. 同步报告 `fork-reports/YYYY-MM-DD-upstream-<from>-to-<to>.html`（中文，一次同步一份，统一存放于 `fork-reports/`，命名沿用既有惯例）。必含两块内容：
   - **上游更新日志（按主题）**——向用户介绍上游本次更新了什么（主题归纳 + 模型可见行为变化 + 与 fork 面的交互），这是用户固定要读的部分，不许省略；
   - 同步审查——变更规模、认领面命中与冲突决议、门禁与冒烟结果、插件判定、遗留项。
2. `fork-reports/INDEX.md` 加行。
3. `node scripts/fork/sync-scope.mjs snapshot`（若认领表或 delta 有变化）。

## 不可做

- rebase 已推送的 fork master 历史（公开历史只 merge-forward）；
- 自动升级插件（staging 绿也要人确认窗口内一起上）；
- 手工编辑 `~/.dsh/profiles/web/`（profile 是 install.sh 的产物）；
- 跳过冒烟门禁部署；
- 在 `/tmp` 下跑 staging 冷装（noexec 挂载，node-pty 原生模块加载必失败——用脚本默认的 `~/.dsh/.plugin-stage`）。
