#!/usr/bin/env bash
# scripts/fork/smoke.sh — dsh web 服务端分层冒烟。
# 每层独立报错并累计失败数；退出码 0 = 全绿。
# 用法: bash scripts/fork/smoke.sh [BASE_URL]     # 默认 http://127.0.0.1:3080
#
# 层定义（每层对应一次实际发生过的故障模式）：
#   L1 服务存活        — HTTP 探测（不用 ps：隔离 PID namespace 下 ps 看不到宿主进程）
#   L2 插件 bundle 可服务 — terminal chunk 200；首页注入的 /plugins/?? 聚合 client bundle 可达
#   L3 PTY 依赖        — POST /sidebar/api/terminal.deps → ok（node-pty 随环境腐烂会在此暴露）
#   L4 WS+PTY 往返     — 真实 WebSocket 升级 + PTY echo 断言
#   L5 栅栏正向        — LAN IP authority（bind 0.0.0.0 自动信任面）访问 /api 与 /sidebar 非 403
#   L6 栅栏负向        — 伪造非信任 Host authority 访问 /api、/sidebar、WS 必须 403/拒绝（上游 Host/Origin 栅栏语义）
#   L7 版本一致        — 注入的 __DSH_WEB_VERSION__ == 仓库 web-app 包版本
set -uo pipefail

BASE=${1:-http://127.0.0.1:3080}
HOSTPORT=${BASE#http://}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
FAILS=0

# L0 鉴权交换：上游 0.1.2-alpha.1 起页面与 /api 走一次性 token → 会话 cookie。
# DSH_SMOKE_TOKEN_URL 由调用方（plugin-stage.sh / install.sh）从服务日志提取；
# 未提供时跳过（旧宿主无鉴权），需要 cookie 的层会随后报 401 暴露缺失。
COOKIE_JAR=$(mktemp)
COOKIE_ARGS=()
if [ -n "${DSH_SMOKE_TOKEN_URL:-}" ]; then
  curl -s -o /dev/null -c "$COOKIE_JAR" --max-time 5 "$DSH_SMOKE_TOKEN_URL"
  COOKIE_ARGS=(-b "$COOKIE_JAR")
fi
trap 'rm -f "$COOKIE_JAR"' EXIT

layer() { # layer <名> <结果0|1> <详情>
  if [ "$2" = 0 ]; then echo "[PASS] $1"; else echo "[FAIL] $1 — $3"; FAILS=$((FAILS + 1)); fi
}

# L1 服务存活
code=$(curl -s -o /dev/null -w '%{http_code}' "${COOKIE_ARGS[@]}" --max-time 5 "$BASE/" 2>/dev/null)
[ "$code" = 200 ]; layer "L1 存活 GET / => $code" $? "期待 200，得到 $code（服务未起或端口不对）"

# L2 插件 bundle：terminal chunk 直连；client bundle 走上游 ?? 聚合端点
# （0.1.2-alpha.1 起单包 /plugins/<id>/client.js 不再单独服务，聚合 URL 以
# 首页 script 标签为准——rev 是内容哈希，不能静态断言）。
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/sidebar/bundle/terminal.js" 2>/dev/null)
[ "$code" = 200 ]; layer "L2a chunk /sidebar/bundle/terminal.js => $code" $? "期待 200（插件 chunk 服务失败）"
combo=$(curl -s "${COOKIE_ARGS[@]}" --max-time 5 "$BASE/" 2>/dev/null | grep -oE '/plugins/\?\?[^" ]+client\.js[^" ]*' | head -1)
combo=${combo//'&amp;'/'&'}
[ -n "$combo" ]; layer "L2b 首页含 ?? 聚合 client bundle" $? "首页未注入 /plugins/?? 聚合 script（client-modules 未挂载？）"
if [ -n "$combo" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE$combo" 2>/dev/null)
  [ "$code" = 200 ]; layer "L2c 聚合 bundle (${#combo} 字符) => $code" $? "期待 200（聚合端点服务失败）"
fi

# L3 PTY 依赖
body=$(curl -s --max-time 5 -X POST "$BASE/sidebar/api/terminal.deps" 2>/dev/null)
echo "$body" | grep -q '"ok":true'; layer "L3 terminal.deps" $? "响应: ${body:0:120}（node-pty 原生模块可能未构建/不可加载）"

# L4 WS+PTY echo（Node >=21 内置 WebSocket，无外部依赖）
ws_result=$(node --input-type=module -e "
const mark = 'smoke-' + process.pid;
// 终端 WS 协议要求 sessionId 与 tab 查询参数，缺省会话层直接 close
const ws = new WebSocket('ws://$HOSTPORT/sidebar/ws/terminal?sessionId=smoke-probe&tab=smoke&cwd=/tmp');
const done = new Promise((resolve) => {
  const t = setTimeout(() => resolve('timeout：5s 内无 PTY 回显'), 5000);
  ws.onopen = () => ws.send('\n echo ' + mark + ' \n');
  ws.onmessage = (ev) => { if (String(ev.data).includes(mark)) { clearTimeout(t); resolve('ok'); } };
  ws.onerror = () => { clearTimeout(t); resolve('ws-error：升级被拒或连接失败'); };
  ws.onclose = (ev) => { clearTimeout(t); resolve('closed：' + (ev.reason || ev.code)); };
});
console.log(await done);
process.exit(0);
" 2>&1)
[ "$ws_result" = ok ]; layer "L4 WS+PTY echo" $? "$ws_result"

# L5/L6 栅栏（上游 Host/Origin 栅栏语义：bind 0.0.0.0 时本机 LAN IPv4 字面量自动进信任面）。
# L5 连真实本机 LAN 地址（Host 头即该 authority，落在自动信任面内）；
# L6 向 loopback 发请求但伪造非信任 Host 头（DNS-rebinding 形态），必须被 403/拒绝。
# 地址/主机名可经环境变量覆盖：DSH_SMOKE_TRUSTED_ADDR（本机 LAN 地址）/
# DSH_SMOKE_UNTRUSTED_HOST（不在信任面的任意主机名）。
TRUSTED_ADDR=${DSH_SMOKE_TRUSTED_ADDR:-10.147.20.97}
UNTRUSTED_HOST=${DSH_SMOKE_UNTRUSTED_HOST:-untrusted.invalid}
PORT=${BASE##*:}

trusted_code_api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -d '{}' "http://$TRUSTED_ADDR:$PORT/api" 2>/dev/null)
[ "$trusted_code_api" != 403 ]; layer "L5a LAN authority → /api => $trusted_code_api" $? "可信来源被拒（403）——栅栏误伤 LAN 地址 $TRUSTED_ADDR"

trusted_code_sb=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "http://$TRUSTED_ADDR:$PORT/sidebar/api/terminal.deps" 2>/dev/null)
[ "$trusted_code_sb" != 403 ]; layer "L5b LAN authority → /sidebar => $trusted_code_sb" $? "插件路由误伤可信来源 $TRUSTED_ADDR"

untrusted_code_api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -d '{}' -H "Host: $UNTRUSTED_HOST:$PORT" "$BASE/api" 2>/dev/null)
[ "$untrusted_code_api" = 403 ]; layer "L6a 伪造 Host → /api => $untrusted_code_api" $? "期待 403（$UNTRUSTED_HOST 被 /api 放行说明 Host 栅栏失效）"

untrusted_code_sb=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H "Host: $UNTRUSTED_HOST:$PORT" "$BASE/sidebar/api/terminal.deps" 2>/dev/null)
[ "$untrusted_code_sb" = 403 ]; layer "L6b 伪造 Host → /sidebar => $untrusted_code_sb" $? "期待 403——插件路由未过 Host 栅栏，当前 $UNTRUSTED_HOST 可达插件路由"

ws_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: $UNTRUSTED_HOST:$PORT" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Version: 13' \
  "$BASE/sidebar/ws/terminal?sessionId=smoke-probe&tab=smoke" 2>/dev/null)
[ "$ws_code" != 101 ]; layer "L6c 伪造 Host → WS upgrade => $ws_code" $? "期待非 101（$UNTRUSTED_HOST 的 WS 升级被放行说明 Host 栅栏失效）"

# L7 版本一致（结构化 global 行渲染为 globalThis["__DSH_WEB_VERSION__"] = "..."）
injected=$(curl -s "${COOKIE_ARGS[@]}" --max-time 5 "$BASE/" 2>/dev/null | grep -oE '__DSH_WEB_VERSION__"\] = "[^"]*"' | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
expected=$(grep -o '"version": *"[^"]*"' "$REPO/packages/bundle/web-app/package.json" | head -1 | cut -d'"' -f4)
[ -n "$injected" ] && [ "$injected" = "$expected" ]
layer "L7 版本一致 ($injected vs $expected)" $? "注入版本为空或不等于仓库 web-app 版本（服务跑的是旧构建？）"

echo "——"
if [ "$FAILS" = 0 ]; then echo "smoke: 全绿 (7 层)"; exit 0; fi
echo "smoke: $FAILS 层失败"; exit 1
