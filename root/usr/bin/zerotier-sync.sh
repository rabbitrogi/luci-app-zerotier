#!/bin/sh

PERSIST_DIR=$(uci -q get zerotier.global.config_path 2>/dev/null)
[ -n "$PERSIST_DIR" ] || PERSIST_DIR="/etc/zerotier"
RUNTIME_DIR="/var/lib/zerotier-one"

# config_path pointing at the runtime home itself would sync a dir onto itself
[ "$PERSIST_DIR" = "$RUNTIME_DIR" ] && exit 0
# copy_config_path=0 links CONFIG_PATH to config_path: same directory, nothing
# to sync (and copying files onto themselves would just error)
[ "$(readlink -f "$RUNTIME_DIR" 2>/dev/null)" = "$(readlink -f "$PERSIST_DIR" 2>/dev/null)" ] && exit 0

[ -d "$RUNTIME_DIR" ] || exit 0
mkdir -p "$PERSIST_DIR" || exit 1

# Mirror the daemon state dirs: drop persisted files the daemon has removed
# from the runtime dir. Without this, e.g. a left network's networks.d/<id>.conf
# survives here and gets copied back into the runtime dir on the next start,
# rejoining the network (an <id>.conf present there means "join"). Only these
# daemon-managed dirs are pruned — top-level files (planet, local.conf,
# identity.secret, ...) may be user-managed and are never deleted here.
for d in networks.d moons.d peers.d controller.d; do
	[ -d "$PERSIST_DIR/$d" ] || continue
	find "$PERSIST_DIR/$d" -type f | while read -r f; do
		rel="${f#"$PERSIST_DIR"/}"
		[ -f "$RUNTIME_DIR/$rel" ] || rm -f "$f"
	done
	find "$PERSIST_DIR/$d" -depth -type d -empty -delete 2>/dev/null
done

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
