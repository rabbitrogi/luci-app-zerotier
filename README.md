# luci-app-zerotier (JavaScript Edition)

A modern LuCI interface for ZeroTier VPN on OpenWrt, converted from the original Lua version and continuously improved.

Forked from https://github.com/zhengmz/luci-app-zerotier, initially converted to JavaScript using AUGMENT Code plugin in VS Code, then further refined and bug-fixed using [OpenCode](https://opencode.ai) + GLM-5.1.

## Features

- **Network Management** — Join/leave ZeroTier networks, configure settings
- **Auto NAT Clients** — Automatic firewall rule management (zerotier ↔ lan, zerotier → wan)
- **Interface Info** — Structured display of networks, peers, and node identity
- **Ping All** — Batch ping all IPs in connected networks, show online hosts
- **Real-time Status** — Live service status and identity display with polling
- **Chinese (Simplified)** — Full i18n support via `po/zh_Hans/`

## RPC Methods

The custom `luci-zerotier` RPC object provides these methods (no `luci.exec` needed):

| Method | Access | Description |
|---|---|---|
| `status` | read | Service running state, NAT setting, firewall rule count |
| `get_networks` | read | `zerotier-cli listnetworks` output |
| `get_identity` | read | Node address from `zerotier-cli info` |
| `get_peers` | read | `zerotier-cli listpeers` output |
| `ping_networks` | read | Concurrent ping scan of all assigned IP subnets |
| `reload` | write | Reload firewall rules via `/etc/init.d/luci-zerotier reload` |
| `restart_service` | write | Restart the zerotier daemon |

## Installation

```bash
# From IPK
opkg install luci-app-zerotier_*.ipk

# From OpenWrt source tree
cp -r package/luci-app-zerotier <openwrt_source>/package/
make package/luci-app-zerotier/compile
```

## File Structure

```
htdocs/luci-static/resources/view/zerotier/
├── general.js          # Settings page (enable, NAT, networks, advanced)
└── info.js             # Info page (identity, networks table, peers table, ping)

root/usr/libexec/rpcd/
└── luci-zerotier       # RPC daemon (status, networks, identity, peers, ping)

root/etc/init.d/
└── luci-zerotier       # Firewall management (zone + forwarding rules)
```

## Firewall Rules (when NAT=1)

When Auto NAT is enabled, `init.d/luci-zerotier` creates:

- **Zone** `zerotier`: input=ACCEPT, output=ACCEPT, forward=ACCEPT, masq=1, device glob `zt+`
- **Forwarding** `zerotier → lan`: ZT clients can access LAN
- **Forwarding** `lan → zerotier`: LAN devices can reach ZT peers
- **Forwarding** `zerotier → wan`: ZT clients can use this device as internet gateway

Since r23 the zone matches devices with the `zt+` glob, which fw4 renders as the
nftables wildcard `iifname/oifname "zt*"`. Rules therefore match current and
future ZeroTier devices without any `zerotier-cli` device enumeration or
readiness wait loop, stay correct no matter how long controller authorization
takes, and automatically cover devices of newly joined networks. `start()` is
idempotent: when the desired rules already exist it does nothing (no uci
writes, no firewall reload).

## Changelog

### v2.2-r24 (current)

**Bug fixes**
- `general.js`: the service reload now runs **after** `ui.changes.apply()` has
  committed the configuration. Previously a custom `m.save` hook reloaded right
  after `Map.save()` — which only stages changes into the ubus session — so the
  init script read the *previous* committed config while the notification showed
  the not-yet-applied value. Reloading is effectively free now: r23's idempotent
  `start()` makes it a no-op when rules are already in place.
- `info.js`: the Ping button label now updates via `textContent` — `E('button')`
  creates a `<button>` element, so setting `.value` had no visual effect and
  "Pinging..." was never displayed. Added the missing `resultEl` null guard, and
  an all-offline result (`Online: 0`) now renders orange instead of green.

**Housekeeping**
- README: `get_peers` description corrected to `zerotier-cli listpeers`.
- Removed the stray empty `root/etc/zerotier/zerotier.log` from the package.

### v2.2-r23

**Firewall rework (reproduced and verified on OpenWrt 24.10.7 / fw4-2024.12.18)**

- **Removed `firewall.include` entirely.** The include restarted `luci-zerotier` on
  every fw4 reload, and `init.d/luci-zerotier` in turn called `/etc/init.d/firewall
  reload` — re-entering fw4 while it holds `/var/run/fw4.lock` (fw4 keeps the lock
  for the whole run, *including* the includes phase). The nested fw4 deadlocked for
  30s until ucode SIGKILLed the include, and the orphaned nested fw4 then started a
  **self-sustaining reload cascade**: ~36s cycles, a growing process backlog (each
  stop+start enqueues 2 nested reloads, the lock drains 1 per cycle), the zerotier
  zone flapping (deleted/re-added), and flash writes (sync + uci commit) on every
  cycle. The include's registration is also cleaned up by `uci-defaults` on upgrade.
- **Zone devices now use the `zt+` glob** instead of runtime `zerotier-cli`
  enumeration + a 20s readiness wait loop. fw4 renders `list device 'zt+'` as the
  nftables wildcard `iifname/oifname "zt*"`, matching current *and future* devices:
  no timing dependency (controller authorization can be slow on cold starts), no
  `zerotier-cli`/`jsonfilter` dependency in the init script, and devices of newly
  joined networks are covered automatically.
- **Boot persistence out of the box**: `uci-defaults` now runs
  `/etc/init.d/luci-zerotier enable`. Previously nothing enabled the service, so
  rules created on save were lost at reboot until the next manual save.
- **`start()` is idempotent**: when the desired zone/forwardings already exist it
  does nothing — no uci writes, no firewall reload (faster boot, no reload spam on
  repeated saves). Legacy static-device zones are rebuilt with the glob on first run.
- **Stale-rule cleanup**: disabling `enabled` or `nat` now *removes* the
  zone/forwardings instead of leaving them behind.
- **fw4 lock guard**: all firewall reloads go through `fw_reload()`, which skips the
  explicit reload if fw4 currently holds its lock (whoever holds it has already
  rendered the just-committed uci state, so skipping is safe).
- **uci transaction race hardening**: every `uci commit firewall` fires procd's
  config trigger, making fw4 re-render asynchronously. When a previous commit's
  render was still in flight, subsequent individual `uci` commands intermittently
  failed (`uci: Invalid argument`) and committed state silently lost options
  (reproduced: the zone's `name` vanished; fw4 then skipped the zone *and* all
  forwardings — NAT broken). All edits of a phase now happen in a single
  `uci batch` invocation, and the committed result is verified with a retry loop
  (the retry fired and self-healed during 5/5 consecutive-restart stress runs).
- **Sync cron self-heals**: `init.d/luci-zerotier start()` re-asserts the hourly
  `zerotier-sync` cron entry if missing, because restoring a config backup wipes
  the crontab while `uci-defaults` only run once.
- **ucitrack migrated to JSON**: reload-on-apply is now registered via
  `/usr/share/ucitrack/luci-app-zerotier.json` (procd config trigger). The old
  `uci add ucitrack` registration in `uci-defaults` was dead code: modern ucitrack
  only reads `/usr/share/ucitrack/*.json`, and `uci add` fails outright on systems
  where `/etc/config/ucitrack` does not exist (verified on 24.10.7).
- **`local_conf` renamed to `local_conf_path`** (fixes a long-standing silent
  failure): the LuCI form stored the local.conf path under `local_conf`, but the
  zerotier package init script only honors `local_conf_path` — the setting never
  reached the daemon. `uci-defaults` migrates existing values on upgrade. Also
  fixed the placeholder/validator mismatch: `/etc/zerotier.conf` (the upstream
  package's conventional location, used as the field placeholder) was rejected by
  both validators; it is now explicitly allowed for `local_conf_path` only.

### v2.2-r22

**Bug fixes**
- Fixed `firewall.include` not being executable: fw3 invokes include scripts via `execve()` when `type=script` and `reload=1`, so without `+x` the include was silently skipped. `uci-defaults` now `chmod +x` it explicitly.
- Fixed firewall include/zone name collision: the include was registered as `firewall.zerotier` (same name as the runtime zone). On first firewall reload, `init.d/luci-zerotier` deleted `firewall.zerotier` to create the zone — which also deleted the include itself, so subsequent reloads never re-triggered the script. Include renamed to `firewall.zerotier_include`.

**JSON migration (reliability)**
- All `zerotier-cli` calls now use `-j` (JSON output) instead of text-mode `awk` column parsing:
  - `get_identity`: `zerotier-cli -j info` → `jsonfilter -e '@.address'` (was `awk '{print $3}'`)
  - `get_networks` / `get_peers`: return raw JSON, frontend `JSON.parse()` replaces fragile `split(/\s+/)` text parsing
  - `ping_networks`: `zerotier-cli -j listnetworks | jsonfilter -e '$[*].assignedAddresses[*]'` replaces the `while read | set -- | $9` pipeline
  - `init.d` device detection: `jsonfilter -e '$[*].portDeviceName'` replaces `awk '$8 ~ /^zt/'`
- Peers table: removed `Last TX` / `Last RX` columns (raw epoch timestamps were not useful); `link` status now derived from `peer.tunneled` / `paths[].active` JSON fields instead of fragile text columns.

**Hardening**
- `ping_networks`: replaced batch-wait concurrency (`MAX_PARALLEL=32`, one slow ping stalled the whole batch) with a **FIFO counting semaphore**. Uses a named pipe pre-filled with tokens; each `ping_one()` blocks on `read -u 9` until a slot frees, and the background subshell returns its token on completion. **MAX_RUNNING is adaptive**: derived from `MemAvailable / 3 / 300 kB-per-slot` (measured 150 kB RSS per concurrent slot, 2x safety margin, 1/3 of available memory), clamped to [16, 512]. On a 1GB RAM router (~750 MB free) this yields 512, so a /23 (512 IPs) runs in a single wave (~3s). On a 128 MB device (~64 MB free) it still yields 512. Only very low-memory devices (< 16 MB free) scale down. Tested on busybox ash 1.35 (OpenWrt's `/bin/sh`), R2S (1 GB RAM), and OpenWrt VM.
- `secret` field: value is now displayed masked (first 4 + bullets + last 4 chars) instead of in plaintext. The full submitted value is still written to `/etc/config/zerotier` when the user replaces it; empty submissions or unchanged masked value preserve the existing secret (no accidental overwrite).
- Server-side path validation: `init.d/luci-zerotier` now validates `local_conf` and `config_path` UCI values on reload, rejecting paths outside `/etc/zerotier`, `/var/lib/zerotier`, `/tmp` (mirrors the client-side regex in `general.js`). Defense-in-depth against bypassing the frontend.
- Network ID: added format validation (must be 16 hex chars).
- ACL cleanup: removed legacy `rpcd/zerotier` backend (dead code, still using `ifconfig | grep`). Renamed ACL group key from `"luci-app-zerotier"` to `"luci-app-zerotier-rpc"` in the RPC ACL file to avoid silent overwrite when both ACL files define the same key.

**Documentation**
- `local.conf.template`: removed the invalid default `"tcpFallbackRelay": "<RELAY_SERVER_IP>/443"` (placeholder was not a valid IP, broke ZeroTier parsing). The generated `local.conf` now ships without `tcpFallbackRelay`; users who need TCP fallback uncomment and set their relay IP (e.g. `10.10.10.10/443`) following the inline instructions.
- `ping_networks`: added design comment documenting the `/23` scan ceiling — larger subnets (`/22`, `/21`, `/16`) only scan the containing `/24` because /23 covers typical ZeroTier deployments and scanning thousands of hosts is out of scope (use `nmap` instead).

### v2.2-r21

**Frontend rewrite (info.js)**
- Replaced plain textarea with structured tables for networks and peers
- Added color-coded indicators: status (green/red/orange), role (PLANET/MOON/LEAF), link (DIRECT/RELAY)
- Added "Ping All" button with concurrent subnet scanning and online host display
- Added node identity (address) display with 10s polling

**Frontend cleanup (general.js)**
- Removed verbose `console.log` debug output
- Removed 5-second `setTimeout` delay — service reload is now immediate on save
- Added path validation for `local_conf` and `config_path` (must be under `/etc/zerotier`, `/var/lib/zerotier`, or `/tmp`)
- Added node identity display on settings page

**RPC daemon (luci-zerotier)**
- Replaced `get_interfaces` with dedicated `get_networks`, `get_identity`, `get_peers`, `ping_networks`
- Added `ping_networks` method: parses assigned IPs, spawns concurrent ping processes, returns OK/FAIL results
- Used POSIX here-doc (instead of bash process substitution) for shell compatibility
- Changed process detection from `pgrep` to `ps | grep` (more portable)

**Init script (luci-zerotier)**
- Fixed: device detection now uses `zerotier-cli listnetworks | awk '$8 ~ /^zt/'` instead of `ifconfig | grep 'zt'`
  - Only matches real `zt` device names, filters out `-` (not-yet-ready placeholder)
  - Avoids writing invalid interface names to firewall zone device list
- Fixed: added 2s×10 polling loop with timeout for device readiness
- Fixed: added `zerotier-one` daemon check (not just init script status)
- Fixed: proper variable quoting (`"$enabled"` instead of bare `$enabled`)
- Added: `zerotier → wan` forwarding rule (gateway mode for ZT peers)
- Added: `reload_service()` function
- Cleaned up `stop()` to always delete all firewall rules

**Security**
- Removed `luci.exec` from ACL permissions
- Removed dangerous `exec` RPC method from all code paths

**Legacy RPC (zerotier)**
- Fixed: `grep 'zt'` → `grep '^zt'` to avoid matching unrelated interfaces

**Translations (po/zh_Hans)**
- Added 40+ new entries for all new UI strings

### v2.2-r20 (initial JavaScript conversion)

- Complete Lua → JavaScript conversion using AUGMENT Code
- Custom `luci-zerotier` RPC object replacing `luci.exec`
- Auto NAT Clients with service reload
- Basic interface info display (textarea-based)

## License

Apache License 2.0

## Acknowledgments

- Original Lua version: https://github.com/zhengmz/luci-app-zerotier
- ZeroTier: https://www.zerotier.com
- OpenWrt LuCI framework
