#!/bin/sh

PERSIST_DIR="/etc/zerotier"
RUNTIME_DIR="/var/lib/zerotier-one"

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
