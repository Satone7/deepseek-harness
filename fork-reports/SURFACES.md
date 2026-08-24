# Fork SURFACES —— fork delta 的机器事实源

由 `scripts/fork/sync-scope.mjs snapshot` 生成；认领表（下方 JSON 块）手工维护。
规则：**每个 M/D 文件必须被认领**（check 子命令强制）；新增文件（A）无需认领但登记有益。
同步窗口用 `sync-scope.mjs diff <oldTag> <newTag>` 输出重点审查面。

## 认领表

<!-- claims:v1 -->
```json
[
  {
    "feature": "feat(connection): LAN trusted-network fence",
    "globs": [
      "packages/client/connection/**",
      "packages/bundle/web-app/**",
      "packages/client/web/**",
      "apps/web/tsconfig.json",
      "apps/cli/tests/built-bin.e2e.ts",
      "apps/cli/composition.md",
      "apps/cli/reference/**",
      "docs/config-catalog*",
      "AGENTS.md"
    ],
    "test": "packages/client/connection/tests + packages/bundle/web-app/tests/trusted-hosts.spec.ts（栅栏正反向）；scripts/fork/smoke.sh L5/L6"
  },
  {
    "feature": "feat(web-app): settings 版本行",
    "globs": [
      "packages/client/ui-settings-general/**",
      "packages/client/ui-settings/src/client/settings-scope.ts",
      "packages/client/ui-conversation/**",
      "packages/client/runtime/tests/**",
      "apps/web/tests/**"
    ],
    "test": "packages/client/ui-settings-general/tests + apps/web settings-chrome goldens"
  },
  {
    "feature": "feat(base): 默认挂载 claude-code 子代理",
    "globs": [
      "packages/bundle/base/**",
      "apps/cli/config/agent-presets/**",
      "apps/cli/tests/web-agent-presets.e2e.ts",
      "packages/subagent/subagent-claude-code/**"
    ],
    "test": "packages/bundle/base/tests/base.spec.ts"
  },
  {
    "feature": "fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1）",
    "globs": [
      "packages/host/apiproxy/**",
      "packages/util/random-uuid/**",
      "packages/llm/llm/**",
      "tsconfig.host.json",
      "scripts/verify-package-readme-*.ts"
    ],
    "test": "packages/host/apiproxy/tests/client-handler.spec.ts"
  },
  {
    "feature": "同步合并产物（目录重生成/lockfile，语义跟随上游）",
    "globs": [
      "pnpm-lock.yaml",
      "packages/extensions/cordis-client-runner/src/client/slot-catalog.ts",
      "docs/**",
      ".agents/notes/**",
      "fork-reports/**",
      "scripts/fork/**",
      "deploy/**",
      "CLAUDE.local.md"
    ],
    "test": "check 子命令覆盖面本身；无独立运行时行为"
  }
]
```

## 当前 delta 快照（生成，勿手改）

统计：107 个文件（M/D 82，A 25）；已认领 M/D：107。

| 状态 | 路径 | 认领 |
|---|---|---|
| A | `.agents/notes/implemented/architecture/2026-08-17-lan-trusted-network-fence.i18n.yaml` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/architecture/2026-08-17-lan-trusted-network-fence.md` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/architecture/2026-08-17-lan-trusted-network-fence.zh.md` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/bug-fix/2026-08-17-insecure-origin-rpc-ids.i18n.yaml` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/bug-fix/2026-08-17-insecure-origin-rpc-ids.md` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/bug-fix/2026-08-17-insecure-origin-rpc-ids.zh.md` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/feature/2026-08-18-web-settings-version-row.i18n.yaml` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/feature/2026-08-18-web-settings-version-row.md` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `.agents/notes/implemented/feature/2026-08-18-web-settings-version-row.zh.md` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| M | `AGENTS.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `apps/cli/composition.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `apps/cli/config/agent-presets/code/agent.cordis.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `apps/cli/config/agent-presets/cordis/agent.cordis.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `apps/cli/config/agent-presets/cordis/skills/editing-cordis-compositions/SKILL.md` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `apps/cli/config/agent-presets/standard/agent.cordis.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `apps/cli/reference/README.i18n.yaml` | 认领:feat(connection): LAN trusted-network fence |
| M | `apps/cli/reference/README.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `apps/cli/reference/README.zh.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `apps/cli/tests/built-bin.e2e.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `apps/cli/tests/web-agent-presets.e2e.ts` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `apps/web/tests/scaffold.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/settings-chrome.e2e.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/shipped-composition.e2e.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/smoke-real.e2e.ts` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/snapshots/settings-chrome/dialog-en.expected.md` | 认领:feat(web-app): settings 版本行 |
| M | `apps/web/tests/snapshots/settings-chrome/dialog.expected.md` | 认领:feat(web-app): settings 版本行 |
| M | `docs/config-catalog.i18n.yaml` | 认领:feat(connection): LAN trusted-network fence |
| M | `docs/config-catalog.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `docs/config-catalog.zh.md` | 认领:feat(connection): LAN trusted-network fence |
| A | `fork-reports/2026-08-21-upstream-rc.7-to-0.1.1-rc.1.html` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| A | `fork-reports/INDEX.md` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| M | `packages/bundle/base/README.i18n.yaml` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/bundle/base/README.md` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/bundle/base/README.zh.md` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/bundle/base/cordis.patch.yml` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/bundle/base/package.json` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/bundle/base/tests/base.spec.ts` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/bundle/web-app/README.i18n.yaml` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/README.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/README.zh.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/cordis.patch.yml` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/src/index.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/src/startup.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/tests/browser-open.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/tests/startup.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/tests/trusted-hosts.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/tests/web-app.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/bundle/web-app/tsconfig.json` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/README.i18n.yaml` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/README.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/README.zh.md` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/package.json` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/src/client/fixture.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/src/client/index.ts` | 认领:feat(connection): LAN trusted-network fence |
| D | `packages/client/connection/src/client/random-uuid.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/src/client/rpc.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/src/http-bridge.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/src/index.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/src/rpc-host.ts` | 认领:feat(connection): LAN trusted-network fence |
| A | `packages/client/connection/src/trusted-network.ts` | 认领:feat(connection): LAN trusted-network fence |
| A | `packages/client/connection/src/web-trust.ts` | 认领:feat(connection): LAN trusted-network fence |
| A | `packages/client/connection/src/web-version.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/tests/client-apply.client.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/tests/http-bridge.host.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/tests/node-half.host.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| A | `packages/client/connection/tests/trusted-network.host.spec.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/tsconfig.client.json` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/connection/tsconfig.host.json` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/runtime/tests/client-apply.client.spec.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/runtime/tests/wire-events.client.spec.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-conversation/package.json` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-conversation/src/client/service.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/README.i18n.yaml` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/README.md` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/README.zh.md` | 认领:feat(web-app): settings 版本行 |
| A | `packages/client/ui-settings-general/src/client/VersionRow.module.css` | 认领:feat(web-app): settings 版本行 |
| A | `packages/client/ui-settings-general/src/client/VersionRow.tsx` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/src/client/index.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/src/client/locales.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/tests/apply.client.spec.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings-general/tests/components.client.spec.tsx` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/ui-settings/src/client/settings-scope.ts` | 认领:feat(web-app): settings 版本行 |
| M | `packages/client/web/package.json` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/web/src/platform.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/client/web/src/seed.ts` | 认领:feat(connection): LAN trusted-network fence |
| M | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| M | `packages/host/apiproxy/src/fetch/client.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `packages/host/apiproxy/tests/client-handler.spec.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `packages/host/apiproxy/tsconfig.json` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `packages/llm/llm/package.json` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `packages/llm/llm/src/message.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `packages/llm/llm/tsconfig.json` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `packages/subagent/subagent-claude-code/README.i18n.yaml` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/subagent/subagent-claude-code/README.md` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| M | `packages/subagent/subagent-claude-code/README.zh.md` | 认领:feat(base): 默认挂载 claude-code 子代理 |
| A | `packages/util/random-uuid/README.i18n.yaml` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| A | `packages/util/random-uuid/README.md` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| A | `packages/util/random-uuid/README.zh.md` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| A | `packages/util/random-uuid/package.json` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| A | `packages/util/random-uuid/src/index.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| A | `packages/util/random-uuid/src/invariant.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| A | `packages/util/random-uuid/tests/random-uuid.spec.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| A | `packages/util/random-uuid/tsconfig.json` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `pnpm-lock.yaml` | 认领:同步合并产物（目录重生成/lockfile，语义跟随上游） |
| M | `scripts/verify-package-readme-limitations.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `scripts/verify-package-readme-model-experience.ts` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
| M | `tsconfig.host.json` | 认领:fix(apiproxy): 非安全上下文 RPC id（上游化候选 #1） |
