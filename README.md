# luci-app-zerotier (JavaScript Edition)

A modern LuCI interface for ZeroTier VPN on OpenWrt, converted from the original Lua version and continuously improved.

Forked from https://github.com/zhengmz/luci-app-zerotier, initially converted to JavaScript using AUGMENT Code plugin in VS Code, then further refined and bug-fixed using [OpenCode](https://opencode.ai) + GLM-5.1.

## Features

- **Network Management** — Join/leave ZeroTier networks, configure settings
- **Moons** — Orbit/leave private moons, with automatic persistence (no
  zerotier package changes; driven purely through the daemon's `/moon`
  control plane). Note that upstream ZeroTier no longer recommends private
  moons and does not support them under its SLA.
- **Auto NAT Clients** — Automatic firewall rule management (zerotier ↔ lan, zerotier → wan)
- **Interface Info** — Structured display of networks, peers, and node identity
- **Ping All** — Batch ping all IPs in connected networks, show online hosts
- **Real-time Status** — Live service status and identity display with polling
- **Chinese (Simplified)** — Full i18n support via `po/zh_Hans/`

## RPC Methods

The custom `luci-zerotier` RPC object provides these methods (no `luci.exec` needed):

| Method | Access | Description |
|---|---|---|
| `status` | read | Service running state + node address (one call, no `ps`/`uci` forks) |
| `get_networks_peers` | read | `listnetworks` + `listpeers` in one call |
| `list_moons` | read | Orbited moons plus which of them are persisted |
| `ping_networks` | read | Concurrent ping scan of all assigned IP subnets |
| `reload` | write | Reload firewall rules via `/etc/init.d/luci-zerotier reload` |
| `restart_service` | write | Restart the zerotier daemon (syncs runtime state first) |
| `sync_config` | write | Persist runtime state to the config dir; also imports a configured `local_conf_path` into it |
| `orbit_moon` | write | Join a moon, given its ID and one of its root addresses |
| `deorbit_moon` | write | Leave a moon |

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

root/etc/uci-defaults/
└── luci-zerotier       # Install/upgrade migrations, defaults seeding, cleanup

root/usr/bin/
└── zerotier-sync.sh    # Runtime-state persistence (mirror of daemon state dirs)

root/etc/zerotier/
└── local.conf.template # Seeded as /etc/zerotier/local.conf on install

root/usr/share/rpcd/acl.d/     # ACL groups (UCI access + RPC methods)
root/usr/share/ucitrack/       # Reload-on-apply registration
root/lib/upgrade/keep.d/       # Sysupgrade backup list (/etc/zerotier*)
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

### v2.2-r32

**Moons: orbit / persist / leave**

- The info page gains a **Moons** block: the orbited moons with their roots
  and stable endpoints, an *Add Moon* form (moon ID + the address of one of
  its roots) and a *Leave* button. Moon creation is deliberately out of
  scope — a moon's signing key belongs with a future controller page.
- Implemented entirely against the daemon's existing `/moon` control plane
  (`zerotier-cli listmoons|orbit|deorbit`) plus the `moons.d` files this app
  already mirrors. **The zerotier package is not touched.**
- ZeroTier's exit codes are not trustworthy for the mutating calls, so both
  are verified against reality instead:
  - `orbit` is a **silent no-op with exit 0** when the seed is zero, so a
    zero/non-hex seed is rejected up front;
  - `deorbit` returns `200 deorbit OK` **even for a moon that was never
    orbited**, so the moon list is snapshotted before and re-checked after;
  - an orbit only materialises once a root delivers the signed world, which
    can take a while behind a relay — so a wait expiring means *pending*,
    never *failed*, and the UI says so instead of showing a false error;
  - moon IDs are 10 hex digits on the `/moon/<id>` route but are reported
    zero-padded to 16, so IDs are normalised on both sides.
- A moon is mirrored into `config_path` as soon as its definition appears,
  so a late-arriving definition still becomes persistent without the user
  hunting for the *Backup Now* button on the other page.
- The UI notes that upstream ZeroTier no longer recommends private moons and
  does not support them under its SLA.

**Correctness**

- The **Port** field validated nothing (`form.Value` has no `datatype` hook
  in luci.js), so a typo was written to UCI and reached the daemon as
  `-p<value>`. It now checks for digits and the 1–65535 range; `0` stays
  valid because upstream documents it as "pick a random port".
- An unknown peer version rendered as the literal `-1.-1.-1` (ZeroTier's
  string form, which is truthy and so survived `|| '-'`). It now shows `-`.
- **An RPC failure was rendered as "No networks joined" / "No peers"**, so a
  transient rpcd or daemon hiccup looked like a confident "you are not
  connected" — exactly when it matters most. Failure, unreachable-service
  and genuinely-empty are now three distinct states.

**Efficiency** (poll intervals for networks/peers deliberately unchanged)

- `status` forked six processes (`ps`, `grep`, `uci get`, `uci show`,
  `grep`, `wc`) to deliver one boolean, two thirds of which the UI never
  even read. Liveness is now `zerotier-one.pid` + `/proc/<pid>/comm` — zero
  forks, and `comm` also guards against PID recycling. It carries the node
  address too, so the settings page needs one RPC instead of two.
- `get_networks` + `get_peers` merged into `get_networks_peers`. Both are
  the same 1.2 MB `zerotier-one` binary, loaded and connected per call, and
  both tables refresh on the same timer.
- `zerotier-sync.sh` forked a `mkdir` and a `cp` **per file** (~60 forks,
  and a full rewrite of `peers.d` to flash) on every Save&Apply, every
  service stop and every *Backup Now*. It now copies one directory per state
  dir, and no longer persists `peers.d` at all — it is a pure discovery
  cache that the daemon rebuilds on every start. Stale entries there are
  still pruned, so leftovers from earlier versions clean themselves up.
- Service-state polling relaxed from 3s to 10s; it only changes on
  start/stop.

**Housekeeping**

- `PKG_RELEASE` 32.
- `uci-defaults` tested for `/etc/zerotier-one/local.conf`, a path that has
  never existed on OpenWrt (the runtime dir is `/var/lib/zerotier-one`).
- Re-added the `ZeroTier` / `Enable` / `Port` catalogue entries that had
  dropped out of `po/zh_Hans`, so every UI string resolves from this
  package's own catalogue.

### v2.2-r31

**Explicit zone devices, driven by hotplug** — returns to explicit device
names (the pre-r23 concept) without its historical failure modes:

- enumeration reads `/sys/class/net/zt*` directly — no `zerotier-cli` (its
  port file can vanish across restarts), no readiness wait loop;
- updates come from the net hotplug hook, not a firewall include (the
  include re-entered fw4's lock and deadlocked — the 20s wait loop existed
  only to paper over the boot race that caused);
- the zone rewrite is a single atomic `uci batch`, verified and retried;
- **no netifd involvement whatsoever** (see r30).

Moved off the r23 `zt+` glob because LuCI's DeviceSelect flags it as
"Absent Interface" — misleading enough that it got manually "fixed" into
frozen explicit lists on production boxes. Known residue: the port-forward
source-zone picker only renders zone *networks*, so a device-matched zone
still shows `(empty)` there.

### v2.2-r30

**Reverted r29** (`revert: v2.2-r29 zone membership via netifd interfaces`).
The design was incompatible with daemon-managed addressing and caused a
production outage:

1. On OpenWrt 24.10, netifd's device claim for the `proto=none`
   `zerotier_<nwid>` interfaces **flushes the IPv4 addresses** the daemon had
   assigned to the `zt` devices. The daemon does not re-apply them, so the
   node stays unreachable until a daemon restart.
2. During recovery, a service restart left the `zt` devices administratively
   DOWN (daemon online, port file missing) — a "works for everyone except
   this node" state that cost hours of misdirected firewall debugging.

**Do not reintroduce netifd ownership of zerotier-managed devices.**

### v2.2-r29

**Zone membership via netifd interfaces** — replaced the `zt+` glob with
per-network `proto=none` interface sections. *Reverted in r30; kept here
because the two bugs found during its deployment shaped r31.*

1. **uci list parsing**: `uci show` packs list values onto one line as
   `network='v1' 'v2'`; the per-line `sed` never matched, verification could
   not pass, and the post-commit reload never ran while the zone had already
   been rewritten — leaving a zone matching nothing.
2. **Non-atomic transition**: the zone was committed separately from its
   membership, so any failure in between left a zone matching nothing.

### v2.2-r28

**Auto-expiring action feedback** — the post-action banners used
`ui.addNotification()`, which stays until dismissed and whose Dismiss button
depends on a `transitionend` event themes do not reliably produce
(bootstrap implements `.fade-out` as a CSS *animation*, firing
`animationend`; argon has no `.fade-out` rules at all, so on argon the banner
lingered and Dismiss looked dead). All six call sites now use
`ui.addTimeLimitedNotification()` — 5000 ms success, 10000 ms failure — whose
removal is an unconditional `setTimeout`.

### v2.2-r27

**Apply-path overhaul & state-sync hardening (downstream-only, upstream untouched)**

- `init.d/luci-zerotier`: define `reload()` explicitly. rc.common's default
  is `restart` (stop+start), so every LuCI Save&Apply ran the full
  sync + rule teardown/rebuild cycle twice (ucitrack + the explicit RPC
  reload in general.js) — `reload_service()` was dead code all along, as
  that hook only exists for procd scripts. Reload is now the lightweight,
  idempotent `start()` it was meant to be (no uci writes, no firewall
  reload, no sync when rules are already in place).
- Save&Apply now syncs runtime state **before** anything commits.
  Committing the zerotier config fires procd's reload trigger for the
  daemon, whose upstream `stop_service` wipes `/var/lib/zerotier-one`.
  The ucitrack/procd trigger order is not deterministic, so the only
  ordering-safe point is before the commit, while the old runtime dir is
  still intact — previously this path bypassed all sync hooks and could
  discard unsynced controller/moon state.
- `local_conf_path` now works via **import instead of symlinks**:
  `sync_config` (which also runs before every apply) copies the configured
  file over `config_path/local.conf`. Upstream links it with plain
  `ln -s`, which fails silently when `config_path` already provides a
  `local.conf` (this app seeds one) — the import makes the upstream
  `cp -r` deliver the intended content without patching upstream.
  `uci-defaults` likewise no longer seeds `local.conf` when
  `local_conf_path` is set. (UI description updated accordingly.)
- `zerotier-sync.sh`: mirror semantics for the daemon state dirs
  (`networks.d`, `moons.d`, `peers.d`, `controller.d`) — persisted files
  the daemon removed (e.g. a left network's `<id>.conf`) are deleted
  instead of being resurrected into the runtime dir on the next start
  (ghost rejoin: an `<id>.conf` present there means "join"). Top-level
  files (`planet`, `local.conf`, `identity.secret`, ...) are never
  deleted. Symlink-mode `config_path` (`copy_config_path=0`) is detected
  via readlink and skipped instead of copying files onto themselves.
- `ping_networks`: the EXIT trap only removes the lock while it is still
  owned by this process (a scan outliving its deadline could otherwise
  delete a newer process's lock and allow a third concurrent scan), and
  the deadline update is atomic (temp file + rename — a concurrent
  acquirer could read a half-written lockfile and falsely judge it stale).
- Menu: the settings page now also depends on the `luci-app-zerotier-rpc`
  ACL group — its status/identity/reload/backup RPCs live there, so a
  session holding only `luci-app-zerotier` saw a page with all RPCs
  failing.

**Note on manual restarts**: `/etc/init.d/zerotier restart` from the
shell still discards unsynced runtime state (upstream behavior, and a
deliberate act — the runtime dir is volatile by design). Use the UI,
`ubus call luci-zerotier restart_service`, or run `zerotier-sync.sh`
first when the state matters.

### v2.2-r26

**Backup model change: on-demand instead of scheduled**

- Removed the hourly `zerotier-sync` cron job entirely (uci-defaults also
  cleans it up on upgrade). Runtime-state persistence now happens:
  - **manually**, via a new **"Backup Now"** button (Advanced tab of the
    settings page, backed by the new `sync_config` RPC method), and
  - **on lifecycle hooks** — `init.d` `stop()`/`shutdown()` and the
    `restart_service` RPC sync before touching the runtime dir.
- When you actually need to back up: after adding a moon with
  `zerotier orbit` (the UI has no moon configuration, so the runtime dir is
  the only place that state lives), and for **controller nodes** — member
  data exists only in the runtime dir's `controller.d`, so losing it means
  the controller starts empty. Plain clients need no backup at all: identity
  is guaranteed by the UCI `secret`, and `local.conf` is rebuilt from config.
  On docker containers the orderly shutdown path never runs, so the hourly
  cron was the only mechanism there — a full hour of exposure for data that
  mostly does not matter.

### v2.2-r25

**Validators & paths**
- `config_path` is now restricted to `/etc/zerotier`: the daemon refuses to
  start when the directory is missing, so a volatile `/tmp` path would leave it
  dead after every reboot. `/var/lib/zerotier` (never existed on OpenWrt) was
  dropped from both validators. `local_conf_path` keeps `/tmp` and
  `/etc/zerotier.conf`, which is now anchored exactly (the form previously
  accepted `/etc/zerotier.conf/anything`, which the init script then rejected).
- Sysupgrade keep list now covers `/etc/zerotier.conf`.
- `zerotier-sync.sh` honors `zerotier.global.config_path` instead of hardcoding
  the persist dir (state used to be written to `/etc/zerotier` even when a
  custom directory was configured), and skips a self-sync if it ever points at
  the runtime home.

**Shell hardening (all reproduced/verified on busybox ash 1.36)**
- `ping_networks`: CIDR prefixes are glob-validated before any test/arithmetic —
  a non-numeric prefix made both range tests error out (so it was *not* skipped)
  and `$((32 - cidr))` then evaluated as 32, yielding a ~4-billion-iteration
  ping loop as root.
- `ping_networks` lock is now atomic (`set -C` noclobber create, no more
  check-then-create race), stores an absolute deadline that is recomputed from
  the scan size (multi-network scans no longer outlive the old fixed 120s and
  get falsely broken), the EXIT/INT/TERM traps are split so a signal actually
  terminates the script instead of continuing after cleanup, and the pointless
  `rm` after `mktemp` is gone (the results file keeps its 0600 mode).
- `restart_service` RPC now syncs runtime state before restarting — the
  zerotier init's `stop_service` does `rm -rf /var/lib/zerotier-one`, previously
  discarding up to an hour of unsynced state on this path.
- init script is fail-closed when the UCI config is missing entirely (unset
  `$enabled`/`$nat` made both guards error out and fell through to installing
  the rules). `STOP=98` + a dedicated `shutdown()` (sync only) persist runtime
  state at poweroff without firewall churn.

**UI & packaging**
- The secret can finally be cleared from the UI (empty field removes the option;
  the daemon generates a fresh identity on next start). Field description
  updated accordingly.
- Settings page identity display no longer sticks on "Collecting identity..."
  when the daemon is down (shows `-` like the info page).
- Networks grid no longer forces users to invent a section name the backend
  never uses (`anonymous = true`, matching the original Lua app).
- Menu entries now declare `depends.acl` so they only show for sessions holding
  the matching ACL groups; dropped the unused `luci getInitList` grant.
- `uci-defaults` commits firewall only when it actually removed a stale include
  registration (every commit triggers an async fw4 render), and no longer
  restarts uhttpd (which killed the very LuCI session running the install).
- `local.conf.template` no longer pins `primaryPort: 9993` — the app's `Port`
  option is the single source of truth (a local.conf `primaryPort` would compete
  with the daemon's `-p` flag). Template comments updated.
- `po/zh-cn/` removed: `luci.mk` only recognizes `zh_Hans`, so the directory was
  never built. `po/zh_Hans` updated: added the missing `Allow Managed` /
  `Allow Global` / `Allow Default Route` / `Allow DNS` entries, new validator /
  secret strings, removed orphaned entries.

### v2.2-r24

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
