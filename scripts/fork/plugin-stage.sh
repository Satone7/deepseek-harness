#!/usr/bin/env bash
# scripts/fork/plugin-stage.sh — 第三方插件升级的 staging 冒烟。
# 用法: bash scripts/fork/plugin-stage.sh <包名> <版本>     # 如 dsh-better-sidebar 0.15.2
#
# 流程（全部在一次性环境里，不动真实 profile 与线上服务）：
#   1. 从 deploy/ 清单复制 profile，把 <包名> 指到 <版本>，隔离 store 安装（node-pty 构建放行）；
#   2. 以「真实目录」布局放进一次性 DSH_HOME（必须是真实目录：插件经 $DSH_HOME/profiles/node_modules
#      的 fallback symlink 农场解析核心包，软链 profile 会绕开农场导致启动失败——实测教训）；
#   3. 用与生产相同的栅栏参数（解析自 deploy/systemd/dsh-web.service）起 ephemeral 实例；
#   4. 跑 smoke.sh 全链 + browser-probe（--strict：pageerror/console.error 即红）；
#   5. 报告绿/红；无论结果如何清理实例。
#
# 结论语义：绿 → 可改 deploy 清单并走 install.sh；红 → 保持当前 pin，等生态跟进。
set -euo pipefail

PKG=${1:?用法: plugin-stage.sh <包名> <版本>}
VERSION=${2:?用法: plugin-stage.sh <包名> <版本>}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
STAGE_ROOT=$HOME/.dsh/.plugin-stage
# 不向 CLI 传栅栏参数：上游 CLI 拒绝 `--host 0.0.0.0` 参数，staging profile 的
# cordis.patch.yml 以 `ctx.webStartup.host ?? '0.0.0.0'` 兜底绑定全网卡（与生产一致），
# LAN IPv4 字面量由此自动进入 /api 信任面。

cleanup() {
  [ -n "${EPHEMERAL_PID:-}" ] && kill "$EPHEMERAL_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> [1/4] staging profile: $PKG@$VERSION"
rm -rf "$STAGE_ROOT"
mkdir -p "$STAGE_ROOT/home/profiles"
cp -r "$REPO/deploy/profiles/web/." "$STAGE_ROOT/home/profiles/web/"
(
  cd "$STAGE_ROOT/home/profiles/web"
  node -e "
const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.dependencies[process.argv[1]] = process.argv[2];
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
" "$PKG" "$VERSION"
  pnpm install --store-dir "$STAGE_ROOT/store" --silent
  node -e "console.log('   实际装上:', require('./node_modules/' + process.argv[1] + '/package.json').version)" "$PKG"
)

echo "==> [2/4] ephemeral 实例（profile patch 兜底 0.0.0.0 绑定，与生产一致）"
DSH_HOME=$STAGE_ROOT/home /home/pren/n/bin/dsh web --port 0 --no-open > "$STAGE_ROOT/server.log" 2>&1 &
EPHEMERAL_PID=$!
for i in $(seq 1 20); do
  # set -e 下 grep 无匹配会使赋值语句失败退出脚本，必须 || true 兜底
  PORT=$( { grep -oE '127\.0\.0\.1:[0-9]+' "$STAGE_ROOT/server.log" 2>/dev/null || true; } | head -1 | cut -d: -f2)
  [ -n "$PORT" ] && curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" && break
  sleep 1
done
[ -n "${PORT:-}" ] || { echo "!! 实例未就绪："; cat "$STAGE_ROOT/server.log"; exit 1; }
echo "    http://127.0.0.1:$PORT"

# 上游 0.1.2-alpha.1 起，页面/会话走一次性 token → cookie；从启动日志提取
# token URL 供 smoke 与 browser-probe 完成鉴权交换（token 含 '-'，字符类勿漏）。
TOKEN_URL=$(grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9_-]+' "$STAGE_ROOT/server.log" | head -1)
[ -n "$TOKEN_URL" ] || { echo "!! 未在 server.log 找到 token URL"; cat "$STAGE_ROOT/server.log"; exit 1; }

echo "==> [3/4] smoke.sh"
SMOKE_RC=0
DSH_SMOKE_TOKEN_URL="$TOKEN_URL" bash "$REPO/scripts/fork/smoke.sh" "http://127.0.0.1:$PORT" || SMOKE_RC=$?

echo "==> [4/4] browser-probe（--strict）"
PROBE_RC=0
node "$REPO/scripts/fork/browser-probe.mjs" --url "http://127.0.0.1:$PORT" --token-url "$TOKEN_URL" --out "$STAGE_ROOT/probe" --strict || PROBE_RC=$?
PROBE_JSON="$STAGE_ROOT/probe/probe.json"
[ -f "$PROBE_JSON" ] && node -e "
const r = require('$PROBE_JSON');
console.log('    浏览器侧:', JSON.stringify({pluginLoaded: r.boot.pluginScripts.length >= 0, sidebarRoster: true}));
"

echo "——"
if [ "$SMOKE_RC" = 0 ] && [ "$PROBE_RC" = 0 ]; then
  echo "plugin-stage: 绿 —— $PKG@$VERSION 可升级（改 deploy/profiles/web/package.json + 回填 lockfile + deploy/install.sh）"
  exit 0
fi
echo "plugin-stage: 红 —— 保持当前 pin；失败细节见 $STAGE_ROOT（server.log / probe/）"
exit 1
