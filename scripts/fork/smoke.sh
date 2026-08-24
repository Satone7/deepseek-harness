#!/usr/bin/env bash
# scripts/fork/smoke.sh — dsh web 服务端分层冒烟。
# 每层独立报错并累计失败数；退出码 0 = 全绿。
# 用法: bash scripts/fork/smoke.sh [BASE_URL]     # 默认 http://127.0.0.1:3080
#
# 层定义（每层对应一次实际发生过的故障模式）：
#   L1 服务存活        — HTTP 探测（不用 ps：隔离 PID namespace 下 ps 看不到宿主进程）
#   L2 插件 bundle 可服务 — /plugins/dsh-better-sidebar/client.js 与 terminal chunk 均 200
#   L3 PTY 依赖        — POST /sidebar/api/terminal.deps → ok（node-pty 随环境腐烂会在此暴露）
#   L4 WS+PTY 往返     — 真实 WebSocket 升级 + PTY echo 断言
#   L5 栅栏正向        — 可信网段本机地址访问 /api 与 /sidebar 非 403
#   L6 栅栏负向        — 非成员网段本机地址访问 /api、/sidebar、WS 必须 403/拒绝（F3 收口后 L6b/L6c 转绿）
#   L7 版本一致        — 注入的 __DSH_WEB_VERSION__ == 仓库 web-app 包版本
set -uo pipefail

BASE=${1:-http://127.0.0.1:3080}
HOSTPORT=${BASE#http://}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
FAILS=0

layer() { # layer <名> <结果0|1> <详情>
  if [ "$2" = 0 ]; then echo "[PASS] $1"; else echo "[FAIL] $1 — $3"; FAILS=$((FAILS + 1)); fi
}

# L1 服务存活
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/" 2>/dev/null)
[ "$code" = 200 ]; layer "L1 存活 GET / => $code" $? "期待 200，得到 $code（服务未起或端口不对）"

# L2 插件 bundle
for p in "/plugins/dsh-better-sidebar/client.js" "/sidebar/bundle/terminal.js"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE$p" 2>/dev/null)
  [ "$code" = 200 ]; layer "L2 bundle $p => $code" $? "期待 200（插件包或 chunk 服务失败）"
done

# L3 PTY 依赖
body=$(curl -s --max-time 5 -X POST "$BASE/sidebar/api/terminal.deps" 2>/dev/null)
echo "$body" | grep -q '"ok":true'; layer "L3 terminal.deps" $? "响应: ${body:0:120}（node-pty 原生模块可能未构建/不可加载）"

# L4 WS+PTY echo（Node >=21 内置 WebSocket，无外部依赖）
ws_result=$(node --input-type=module -e "
const mark = 'smoke-' + process.pid;
// 终端 WS 协议要求 sessionId 与 tab 查询参数，缺省会话层直接 close
const ws = new WebSocket('ws://$HOSTPORT/sidebar/ws/terminal?sessionId=smoke-probe&tab=smoke');
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

# L5/L6 栅栏（连真实本机地址让 socket 来源落在对应网段；loopback 套接字本就该放行）
# 地址可经环境变量覆盖：DSH_SMOKE_TRUSTED_ADDR（成员网段内的本机地址）/
# DSH_SMOKE_UNTRUSTED_ADDR（不在任何 --trusted-network 的本机地址，默认 eth0）。
TRUSTED_ADDR=${DSH_SMOKE_TRUSTED_ADDR:-10.147.20.97}
UNTRUSTED_ADDR=${DSH_SMOKE_UNTRUSTED_ADDR:-172.29.15.156}

trusted_code_api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -d '{}' "http://$TRUSTED_ADDR:${BASE##*:}/api" 2>/dev/null)
[ "$trusted_code_api" != 403 ]; layer "L5a 可信网段 → /api => $trusted_code_api" $? "可信来源被拒（403）——栅栏误伤成员网段 $TRUSTED_ADDR"

trusted_code_sb=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "http://$TRUSTED_ADDR:${BASE##*:}/sidebar/api/terminal.deps" 2>/dev/null)
[ "$trusted_code_sb" != 403 ]; layer "L5b 可信网段 → /sidebar => $trusted_code_sb" $? "插件路由误伤可信来源 $TRUSTED_ADDR"

untrusted_code_api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -d '{}' "http://$UNTRUSTED_ADDR:${BASE##*:}/api" 2>/dev/null)
[ "$untrusted_code_api" = 403 ]; layer "L6a 非成员网段 → /api => $untrusted_code_api" $? "期待 403（$UNTRUSTED_ADDR 被 /api 放行说明 socket 栅栏失效）"

untrusted_code_sb=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "http://$UNTRUSTED_ADDR:${BASE##*:}/sidebar/api/terminal.deps" 2>/dev/null)
[ "$untrusted_code_sb" = 403 ]; layer "L6b 非成员网段 → /sidebar => $untrusted_code_sb" $? "期待 403——F3 绕过：插件路由未过来源栅栏（B2 收口后此层转绿），当前 $UNTRUSTED_ADDR 可达插件路由"

ws_untrusted=$(node --input-type=module -e "
const ws = new WebSocket('ws://$UNTRUSTED_ADDR:${BASE##*:}/sidebar/ws/terminal');
const done = new Promise((resolve) => {
  const t = setTimeout(() => resolve('timeout'), 4000);
  ws.onopen = () => { clearTimeout(t); resolve('opened：非成员网段 WS 升级被放行'); };
  ws.onerror = () => { clearTimeout(t); resolve('rejected'); };
  ws.onclose = () => { clearTimeout(t); resolve('rejected'); };
});
console.log(await done);
" 2>&1)
[ "$ws_untrusted" = rejected ]; layer "L6c 非成员网段 → WS upgrade" $? "$ws_untrusted（B2 收口后此层转绿）"

# L7 版本一致
injected=$(curl -s --max-time 5 "$BASE/" 2>/dev/null | grep -oE '__DSH_WEB_VERSION__ = "[^"]*"' | head -1 | cut -d'"' -f2)
expected=$(grep -o '"version": *"[^"]*"' "$REPO/packages/bundle/web-app/package.json" | head -1 | cut -d'"' -f4)
[ -n "$injected" ] && [ "$injected" = "$expected" ]
layer "L7 版本一致 ($injected vs $expected)" $? "注入版本为空或不等于仓库 web-app 版本（服务跑的是旧构建？）"

echo "——"
if [ "$FAILS" = 0 ]; then echo "smoke: 全绿 (7 层)"; exit 0; fi
echo "smoke: $FAILS 层失败"; exit 1
