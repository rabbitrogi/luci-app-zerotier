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

### v2.2-r21 (current, opencode + GLM-5.1)

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
