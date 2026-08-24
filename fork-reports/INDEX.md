# fork-reports — fork 专属同步审查与更新日志

本目录是 Satone7/deepseek-harness fork 的本地维护文档库,存放每次 upstream 同步后产出的两类报告:

- **适配审查报告**:fork 自有改动(如 LAN 可信网段、dsh-base 默认挂载 claude-code、Web 设置页版本行)与新版 upstream 的逐点交互面审查结论。
- **更新日志**:该次同步引入的 upstream 变更按主题归纳。

不进 upstream、不进 docs/ 门禁(doc-sync 不投影、无双语配对要求——因此本索引叫 `INDEX.md` 而非 `README.md`,避免进入 translation-pairing 语料)。报告为自包含 HTML,浏览器直接打开。

## 命名约定

```
YYYY-MM-DD-upstream-<from>-to-<to>.html
```

## 报告索引

| 日期 | 同步范围 | 报告 |
|---|---|---|
| 2026-08-21 | 0.1.0-rc.7 → 0.1.1-rc.1(99f6f02fec → 528c682e06,448 commits) | [2026-08-21-upstream-rc.7-to-0.1.1-rc.1.html](2026-08-21-upstream-rc.7-to-0.1.1-rc.1.html) |

## 维护机制文档

| 日期 | 文档 |
|---|---|
| 2026-08-22 | [fork 稳定更新机制设计（观点落盘）](2026-08-22-fork-maintenance-mechanism.md) —— 五大支柱机制 + 落地顺序 + 三个"不再发生"判定标准 |
