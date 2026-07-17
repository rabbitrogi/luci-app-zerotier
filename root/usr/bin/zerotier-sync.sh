#!/bin/sh

PERSIST_DIR=$(uci -q get zerotier.global.config_path 2>/dev/null)
[ -n "$PERSIST_DIR" ] || PERSIST_DIR="/etc/zerotier"
RUNTIME_DIR="/var/lib/zerotier-one"

# config_path pointing at the runtime home itself would sync a dir onto itself
[ "$PERSIST_DIR" = "$RUNTIME_DIR" ] && exit 0

[ -d "$RUNTIME_DIR" ] || exit 0
mkdir -p "$PERSIST_DIR"

cd "$RUNTIME_DIR" || exit 1

find . -type f \
    ! -name 'zerotier-one.pid' \
    ! -name 'zerotier-one.port' \
    ! -name 'zerotier.log' \
    ! -name 'metrics.prom' \
    ! -name '.DS_Store' \
    | while read -r f; do
    mkdir -p "$PERSIST_DIR/$(dirname "$f")"
    cp -a "$f" "$PERSIST_DIR/$f"
done

logger -t zerotier-sync "synced runtime config to $PERSIST_DIR"
