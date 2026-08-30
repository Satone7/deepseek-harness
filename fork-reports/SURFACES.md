# Fork SURFACES —— fork delta 的机器事实源

由 `scripts/fork/sync-scope.mjs snapshot` 生成；认领表（下方 JSON 块）手工维护。
规则：**每个 M/D 文件必须被认领**（check 子命令强制）；新增文件（A）无需认领但登记有益。
同步窗口用 `sync-scope.mjs diff <oldTag> <newTag>` 输出重点审查面。

## 认领表

<!-- claims:v1 -->
```json
[
  {
    "feature": "feat(web-app): settings 版本行",
    "globs": [
      "packages/client/connection/src/web-version.ts",
      "packages/client/connection/src/index.ts",
      "packages/client/connection/src/client/index.ts",
      "packages/client/connection/tsconfig.client.json",
      "packages/client/connection/tsconfig.host.json",
      "packages/bundle/web-app/src/index.ts",
      "packages/client/ui-settings-general/**",
      "packages/client/ui-settings/src/client/settings-scope.ts",
      "packages/extensions/cordis-client-runner/src/client/slot-catalog.ts",
      "apps/web/tsconfig.json",
      "apps/web/tests/**"
    ],
    "test": "packages/client/ui-settings-general/tests + apps/web settings-chrome goldens；scripts/fork/smoke.sh L7（注入版本 == web-app 包版本）"
  },
  {
    "feature": "feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED",
    "globs": [
      "packages/bundle/base/**",
      "packages/preset/agent-presets/**",
      "apps/cli/composition.md",
      "apps/cli/tests/web-agent-presets.e2e.ts",
      "packages/subagent/subagent-claude-code/**"
    ],
    "test": "packages/bundle/base/tests/base.spec.ts"
  },
  {
    "feature": "deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数）",
    "globs": [
      "AGENTS.md",
      "deploy/**",
      "scripts/fork/**",
      "pnpm-lock.yaml",
      ".agents/notes/**",
      "fork-reports/**",
      "CLAUDE.local.md"
    ],
    "test": "scripts/fork/smoke.sh L1-L7（L5 LAN authority 正向 / L6 伪造 Host 负向）"
  }
]
```

## 当前 delta 快照（生成，勿手改）

统计：103 个文件（M/D 42，A 61）；已认领 M/D：96。

| 状态 | 路径 | 认领 |
|---|---|---|
| A | `.agents/notes/implemented/architecture/2026-08-17-lan-trusted-network-fence.i18n.yaml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/architecture/2026-08-17-lan-trusted-network-fence.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/architecture/2026-08-17-lan-trusted-network-fence.zh.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/bug-fix/2026-08-17-insecure-origin-rpc-ids.i18n.yaml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/bug-fix/2026-08-17-insecure-origin-rpc-ids.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/bug-fix/2026-08-17-insecure-origin-rpc-ids.zh.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/feature/2026-08-18-web-settings-version-row.i18n.yaml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/feature/2026-08-18-web-settings-version-row.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/notes/implemented/feature/2026-08-18-web-settings-version-row.zh.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `.agents/skills/fork-upstream-sync/SKILL.md` | 新增(无需认领) |
| M | `AGENTS.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `CLAUDE.local.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| M | `apps/cli/composition.md` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `apps/cli/tests/web-agent-presets.e2e.ts` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `apps/web/tests/expected/settings-chrome/dialog-en.expected.md` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/expected/settings-chrome/dialog.expected.md` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/scaffold.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/settings-chrome.e2e.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/shipped-composition.e2e.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/smoke-real.e2e.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tsconfig.json` | 认领:feat(web-app): settings 版本行 |
| A | `deploy/install.sh` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/cordis.patch.yml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/cordis.yml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/package.json` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/pnpm-lock.yaml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/pnpm-workspace.yaml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/LICENSE` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/README.en.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/README.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/cordis.patch.yml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/package.json` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/catalog.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/api.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/css-modules.d.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/format.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/index.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/locales.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/settings-schema.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/settings/CustomPricesPanel.tsx` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/settings/TokenCostSettingsCard.tsx` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/settings/card.module.css` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/shared/SessionDetailModal.tsx` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/shared/session-detail.module.css` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/stats/StatsCostBridge.tsx` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/stats/stats-line-injector.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/client/time-filters.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/index.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/ledger.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/parser.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/price-store.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/pricing.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/protocol.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/routes.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/profiles/web/vendor/dsh-token-cost/src/trust-fence.ts` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `deploy/systemd/dsh-web.service` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `fork-reports/2026-08-21-upstream-rc.7-to-0.1.1-rc.1.html` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `fork-reports/2026-08-22-fork-maintenance-mechanism.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `fork-reports/2026-08-24-upstream-0.1.1-rc.1-to-0.1.1-rc.2.html` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `fork-reports/2026-08-25-drift-check.html` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `fork-reports/INDEX.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `fork-reports/SURFACES.md` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| M | `packages/bundle/base/README.i18n.yaml` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/bundle/base/README.md` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/bundle/base/README.zh.md` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/bundle/base/cordis.patch.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/bundle/base/package.json` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/bundle/base/tests/base.spec.ts` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/bundle/web-app/README.i18n.yaml` | ⚠️ 未认领 |
| M | `packages/bundle/web-app/README.md` | ⚠️ 未认领 |
| M | `packages/bundle/web-app/README.zh.md` | ⚠️ 未认领 |
| M | `packages/bundle/web-app/src/index.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/bundle/web-app/tests/browser-open.spec.ts` | ⚠️ 未认领 |
| M | `packages/bundle/web-app/tsconfig.json` | ⚠️ 未认领 |
| M | `packages/client/connection/src/client/index.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/connection/src/index.ts` | 认领:feat(web-app): settings 版本行 |
| A | `packages/client/connection/src/web-version.d.ts` | 新增(无需认领) |
| A | `packages/client/connection/src/web-version.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/connection/tsconfig.client.json` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/connection/tsconfig.host.json` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/README.i18n.yaml` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/README.md` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/README.zh.md` | 认领:feat(web-app): settings 版本行 |
| A | `packages/client/ui-settings-general/src/client/VersionRow.module.css` | 认领:feat(web-app): settings 版本行 |
| A | `packages/client/ui-settings-general/src/client/VersionRow.tsx` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/src/client/index.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/src/client/locales.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/tests/apply.client.spec.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/tests/components.client.spec.tsx` | 认领:feat(web-app): settings 版本行 |
| M | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/preset/agent-presets/presets/cordis/agent.cordis.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/preset/agent-presets/presets/ptc/agent.cordis.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/preset/agent-presets/presets/standard/agent.cordis.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/subagent/subagent-claude-code/README.i18n.yaml` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/subagent/subagent-claude-code/README.md` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `packages/subagent/subagent-claude-code/README.zh.md` | 认领:feat(base): 默认挂载 claude-code 子代理 + 遥测默认 DISABLED |
| M | `pnpm-lock.yaml` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `scripts/fork/browser-probe.mjs` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `scripts/fork/peer-check.mjs` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `scripts/fork/plugin-stage.sh` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `scripts/fork/smoke.sh` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
| A | `scripts/fork/sync-scope.mjs` | 认领:deploy: 0.0.0.0 绑定走 profile patch（上游 CLI 拒绝 --host 0.0.0.0 参数） |
