#!/usr/bin/env bash
# deploy/install.sh — profile 冷装 → 原子切换 → 服务重启 → 冒烟门禁 → 失败回滚。
# 用法: bash deploy/install.sh [--skip-smoke]
#
# 约定：
#   - profile 清单、lockfile、vendored 包、systemd unit 以 git 里的 deploy/ 为准；
#     真实 profile（~/.dsh/profiles/web）是本脚本的产物，不再手工编辑。
#   - staging 与备份放在 ~/.dsh 下（/tmp 是 noexec 挂载，node-pty 的 .node 无法加载）。
#   - 回滚用 mv 不 rm：失败现场保留在 backups/ 下供诊断。
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
PROFILE_NAME=web
DSH_ROOT=${DSH_HOME:-$HOME/.dsh}
REAL=$DSH_ROOT/profiles/$PROFILE_NAME
STAGE=$DSH_ROOT/.deploy-staging/$PROFILE_NAME
BACKUPS=$DSH_ROOT/.deploy-backups
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$STAGE" "$BACKUPS"

echo "==> [1/4] staging 冷装（隔离 store，防缓存掩盖 registry 差异）"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r "$REPO/deploy/profiles/$PROFILE_NAME/." "$STAGE/"
(
  cd "$STAGE"
  pnpm install --frozen-lockfile --store-dir "$STAGE/.pnpm-store"
)

echo "==> [2/4] 原子切换真实 profile（旧 profile 保留为备份）"
if [ -d "$REAL" ]; then
  mv "$REAL" "$BACKUPS/$PROFILE_NAME-$STAMP"
fi
mv "$STAGE" "$REAL"

echo "==> [3/4] systemd unit 刷新 + 服务重启"
mkdir -p "$HOME/.config/systemd/user"
cp "$REPO/deploy/systemd/dsh-web.service" "$HOME/.config/systemd/user/dsh-web.service"
systemctl --user daemon-reload
sleep 1

rollback() {
  echo "!! 冒烟未通过，回滚到切换前 profile（失败现场保留）" >&2
  mv "$REAL" "$BACKUPS/$PROFILE_NAME-$STAMP-failed"
  mv "$BACKUPS/$PROFILE_NAME-$STAMP" "$REAL"
  systemctl --user restart dsh-web.service
  echo "已回滚；失败现场: $BACKUPS/$PROFILE_NAME-$STAMP-failed" >&2
  exit 1
}

systemctl --user restart dsh-web.service
# 端口就绪后再跑冒烟
for i in $(seq 1 20); do
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:3080/ && break
  sleep 1
done

if [ "${1:-}" = --skip-smoke ]; then
  echo "==> [4/4] 跳过冒烟（--skip-smoke）"
  echo "install.sh: 完成（未验证）"
  exit 0
fi

echo "==> [4/4] 冒烟门禁"
if ! bash "$REPO/scripts/fork/smoke.sh" http://127.0.0.1:3080; then
  rollback
fi
echo "install.sh: 部署完成，冒烟全绿"
