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
| `get_peers` | read | `zerotier-cli peers` output |
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
├── luci-zerotier       # Primary RPC daemon (status, networks, identity, peers, ping)
└── zerotier            # Legacy RPC daemon (status, interfaces, reload)

root/etc/init.d/
└── luci-zerotier       # Firewall management (zone + forwarding rules)

root/usr/share/zerotier/
└── firewall.include    # Firewall reload trigger
```

## Firewall Rules (when NAT=1)

When Auto NAT is enabled, `init.d/luci-zerotier` creates:

- **Zone** `zerotier`: input=ACCEPT, output=ACCEPT, forward=ACCEPT, masq=1, devices=zt*
- **Forwarding** `zerotier → lan`: ZT clients can access LAN
- **Forwarding** `lan → zerotier`: LAN devices can reach ZT peers
- **Forwarding** `zerotier → wan`: ZT clients can use this device as internet gateway

Device detection uses `zerotier-cli listnetworks` (field `$8 ~ /^zt/`) with a 20-second timeout, avoiding the old `ifconfig | grep 'zt'` approach that could match stale or invalid interfaces.

## Changelog

### v2.2-r22 (current)

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
