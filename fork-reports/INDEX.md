# fork-reports — fork 专属同步审查与更新日志

本目录是 Satone7/deepseek-harness fork 的本地维护文档库,**每次 upstream 同步产出一份中文 HTML 报告**（一次同步一份，统一存放本目录），包含两块内容:

- **适配审查**:fork 自有改动(如 LAN 可信网段、dsh-base 默认挂载 claude-code、Web 设置页版本行)与新版 upstream 的逐点交互面审查结论、冲突决议、门禁与冒烟结果。
- **上游更新日志(按主题)**:该次同步引入的 upstream 变更按主题归纳——用户固定要读的部分,不许省略。

不进 upstream、不进 docs/ 门禁(doc-sync 不投影、无双语配对要求——因此本索引叫 `INDEX.md` 而非 `README.md`,避免进入 translation-pairing 语料)。报告为自包含 HTML,浏览器直接打开。fork 不向上游提交 PR(2026-08-24 确认的永久策略)。

## 命名约定

```
YYYY-MM-DD-upstream-<from>-to-<to>.html
```

## 报告索引

| 日期 | 同步范围 | 报告 |
|---|---|---|
| 2026-08-24 | 0.1.1-rc.1 → 0.1.1-rc.2(35 commits,主线为图像管线统一化;同窗口含终端/预览根因修复、栅栏收口、插件 0.15.2;首次按 fork-upstream-sync SKILL 执行) | [2026-08-24-upstream-0.1.1-rc.1-to-0.1.1-rc.2.html](2026-08-24-upstream-0.1.1-rc.1-to-0.1.1-rc.2.html) |
| 2026-08-21 | 0.1.0-rc.7 → 0.1.1-rc.1(99f6f02fec → 528c682e06,448 commits) | [2026-08-21-upstream-rc.7-to-0.1.1-rc.1.html](2026-08-21-upstream-rc.7-to-0.1.1-rc.1.html) |

## 维护机制文档

| 日期 | 文档 |
|---|---|
| 2026-08-22 | [fork 稳定更新机制设计（观点落盘）](2026-08-22-fork-maintenance-mechanism.md) —— 五大支柱机制 + 落地顺序 + 三个"不再发生"判定标准;**2026-08-24 已实施**(同窗口落地,订正 F5 peer 误判,见文末实施记录) |
| 2026-08-24 | [SURFACES.md](SURFACES.md) —— fork delta 机器事实源(`scripts/fork/sync-scope.mjs` 生成,认领表强制覆盖每个 M/D) |

## 机制入口

- 同步/兼容排查流程:[`.agents/skills/fork-upstream-sync/SKILL.md`](../.agents/skills/fork-upstream-sync/SKILL.md)(上游同步一律走此 SKILL)
- fork 开发规则:[`CLAUDE.local.md`](../CLAUDE.local.md)(每次会话自动加载)
- 部署:`bash deploy/install.sh`(冷装+冒烟门禁+失败回滚)
