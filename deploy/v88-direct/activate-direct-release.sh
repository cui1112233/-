#!/usr/bin/env bash
# V88 代码直传：在服务器上把 current 软链切到指定版本并重启 go-api / v88-node。
# 由 Windows 端 deploy-v88-direct.ps1 通过 SSH 调用，也可手工执行：
#   bash activate-direct-release.sh <git-sha>
#
# 安全保证：
#   - 只重建 go-api、v88-node，以及反代它们的 Nginx；不碰 MySQL/浏览器工人；
#   - 切换前记录上一版软链，健康检查失败自动回滚并恢复旧版本；
#   - 不修改、不依赖任何国外镜像拉取。
set -Eeuo pipefail

SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "usage: activate-direct-release.sh <git-sha>" >&2; exit 2; }

DIRECT_ROOT='/opt/qiantie/v88/direct'
DEPLOY_DIR='/opt/qiantie/v88/deploy/v88-public'
BASE_COMPOSE="$DEPLOY_DIR/docker-compose.yml"
OVERRIDE="$DIRECT_ROOT/docker-compose.direct.yml"
RELEASE_DIR="$DIRECT_ROOT/releases/$SHA"

[ -x "$RELEASE_DIR/go/qiantie" ] || { echo "STATUS=FAILED missing go binary: $RELEASE_DIR/go/qiantie" >&2; exit 3; }
[ -f "$RELEASE_DIR/node/server.js" ] || { echo "STATUS=FAILED missing node app: $RELEASE_DIR/node/server.js" >&2; exit 4; }
[ -s "$BASE_COMPOSE" ] || { echo "STATUS=FAILED missing $BASE_COMPOSE" >&2; exit 5; }
[ -s "$OVERRIDE" ] || { echo "STATUS=FAILED missing $OVERRIDE" >&2; exit 6; }
cd "$DEPLOY_DIR"

# 1) 记录回滚点（当前软链目标 + 当前 .env 中的 DIRECT_RELEASE_SHA）。
# readlink 返回的是当初写进软链的“原始字符串”：本脚本写的是绝对路径，
# 历史脚本可能写相对路径。这里统一折算成可直接判断的绝对目录 PREV_DIR。
# 不折算的话 "$DIRECT_ROOT/$PREV_TARGET" 会拼成 /opt/...//opt/... 这种假路径，
# 让 -d 判断永远为假：previous 软链永不更新、回滚还会被整个跳过。
PREV_TARGET="$(readlink "$DIRECT_ROOT/current" 2>/dev/null || true)"
PREV_SHA="$(grep -E '^DIRECT_RELEASE_SHA=' .env 2>/dev/null | tail -1 | cut -d= -f2 || true)"
if [ -n "$PREV_TARGET" ]; then
  case "$PREV_TARGET" in
    /*) PREV_DIR="$PREV_TARGET" ;;
    *)  PREV_DIR="$DIRECT_ROOT/$PREV_TARGET" ;;
  esac
else
  PREV_DIR=""
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

rollback() {
  local status=$?
  echo "STATUS=ROLLBACK release failed, restoring previous state (exit=$status)" >&2
  if [ -n "$PREV_DIR" ] && [ -d "$PREV_DIR" ]; then
    ln -sfn "$PREV_DIR" "$DIRECT_ROOT/current"
    if [ -n "$PREV_SHA" ]; then set_env DIRECT_RELEASE_SHA "$PREV_SHA"; fi
    docker compose -f "$BASE_COMPOSE" -f "$OVERRIDE" up -d --no-deps --force-recreate --pull never go-api v88-node >/dev/null 2>&1 || true
    docker compose -f "$BASE_COMPOSE" restart nginx >/dev/null 2>&1 || true
  else
    # First direct release has no prior release symlink. Restore the base
    # image runtime rather than mounting the failed, partial release again.
    rm -f "$DIRECT_ROOT/current"
    set_env DIRECT_RELEASE_SHA ""
    docker compose -f "$BASE_COMPOSE" up -d --no-deps --force-recreate --pull never go-api v88-node >/dev/null 2>&1 || true
    docker compose -f "$BASE_COMPOSE" restart nginx >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback ERR

# 2) 原子切换软链与版本变量。
ln -sfn "$RELEASE_DIR" "$DIRECT_ROOT/current"
set_env DIRECT_RELEASE_SHA "$SHA"

# 3) 校验合并后的 compose 配置。
docker compose -f "$BASE_COMPOSE" -f "$OVERRIDE" config -q

# 4) 只重建两个应用容器，明确 --pull never，绝不走国外镜像下载。
docker compose -f "$BASE_COMPOSE" -f "$OVERRIDE" up -d --no-deps --force-recreate --pull never go-api v88-node

# Nginx 在启动时会缓存上游容器 IP。Node 重建后必须让它重载一次，否则公网会
# 继续转发到已退出的旧 IP 并表现为 502；这不改变任何业务数据或依赖容器。
docker compose -f "$BASE_COMPOSE" restart nginx

# 5) 健康检查：build-info 必须回报本次 SHA（最多等 90 秒）。
ok=0
for _ in $(seq 1 30); do
  got="$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/build-info 2>/dev/null \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("git_sha",""))' 2>/dev/null || true)"
  if [ "$got" = "$SHA" ]; then ok=1; break; fi
  sleep 3
done
if [ "$ok" != 1 ]; then
  echo "STATUS=FAILED build-info did not converge to $SHA" >&2
  exit 7
fi

# 6) 外网再验一次，防止只在内网通。
ext="$(curl -fsS --max-time 8 "http://115.190.156.223:3000/api/build-info" 2>/dev/null \
  | python3 -c 'import json,sys;print(json.load(sys.stdin).get("git_sha",""))' 2>/dev/null || true)"
if [ "$ext" != "$SHA" ]; then
  echo "STATUS=FAILED external build-info mismatch: $ext != $SHA" >&2
  exit 8
fi

# 成功：把上一版记成 previous，方便手工一键回退。
if [ -n "$PREV_DIR" ] && [ -d "$PREV_DIR" ]; then
  ln -sfn "$PREV_DIR" "$DIRECT_ROOT/previous"
fi
trap - ERR
echo "STATUS=DEPLOYED_DIRECT release_sha=$SHA previous=${PREV_DIR:-none}"
