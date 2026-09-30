'use strict';
'require view';
'require ui';
'require rpc';
'require uci';

/*
 * Remote Controller / Moon management.
 *
 * The LuCI page lives on the OpenWrt router, but the Controller and Moon root
 * live on a separate machine with a fixed public IP. Everything here reaches
 * that machine over an SSH-forwarded loopback port; see zerotier-remote.sh for
 * why a tunnel is the only option (no TLS on the control plane, and
 * allowManagementFrom rejects every non-loopback caller).
 *
 * Every remote call costs an SSH handshake (~1-3s), so this page deliberately
 * does NOT poll the way the local Interface Info page does. Diagnostics are
 * refreshed on demand and after mutations.
 */

var rpcHostList = rpc.declare({ object: 'luci-zerotier', method: 'remote_list' });
var rpcHostSet = rpc.declare({
	object: 'luci-zerotier', method: 'remote_host_set',
	params: [ 'section', 'name', 'host', 'port', 'user', 'controller_port', 'private_key' ]
});
var rpcHostDel = rpc.declare({ object: 'luci-zerotier', method: 'remote_host_del', params: [ 'section' ] });
var rpcDiagnose = rpc.declare({ object: 'luci-zerotier', method: 'remote_diagnose', params: [ 'section' ] });
var rpcCtlGet = rpc.declare({ object: 'luci-zerotier', method: 'remote_ctl_get', params: [ 'section', 'path' ] });
var rpcNetSet = rpc.declare({ object: 'luci-zerotier', method: 'remote_network_set', params: [ 'section', 'nwid', 'body' ] });
var rpcNetDel = rpc.declare({ object: 'luci-zerotier', method: 'remote_network_del', params: [ 'section', 'nwid' ] });
var rpcMemberSet = rpc.declare({ object: 'luci-zerotier', method: 'remote_member_set', params: [ 'section', 'nwid', 'member_id', 'body' ] });
var rpcMoonPlan = rpc.declare({ object: 'luci-zerotier', method: 'remote_moon_plan', params: [ 'section' ] });
var rpcMoonApply = rpc.declare({ object: 'luci-zerotier', method: 'remote_moon_apply', params: [ 'section', 'confirm' ] });

function errText(res, fallback) {
	if (!res) return fallback;
	if (res.error) return res.error;
	return fallback;
}

function yn(v, t, f) {
	return E('span', { 'style': 'color: ' + (v ? 'green' : 'orange') }, [ v ? t : f ]);
}

/* ------------------------------------------------------------------ hosts */

function hostEditor(section, host, onSaved) {
	var isNew = !section;
	var f = section || '';

	var nameI = E('input', { 'type': 'text', 'id': 'zt_r_name', 'value': (host && host.name) || '', 'placeholder': _('My controller') });
	var hostI = E('input', { 'type': 'text', 'id': 'zt_r_host', 'value': (host && host.host) || '', 'placeholder': '203.0.113.10' });
	var portI = E('input', { 'type': 'number', 'id': 'zt_r_port', 'value': (host && host.port) || '22', 'min': '1', 'max': '65535' });
	var userI = E('input', { 'type': 'text', 'id': 'zt_r_user', 'value': (host && host.user) || 'root' });
	var cportI = E('input', { 'type': 'number', 'id': 'zt_r_cport', 'value': (host && host.controller_port) || '27893', 'min': '1', 'max': '65535' });
	var keyI = E('textarea', {
		'id': 'zt_r_key', 'rows': '6', 'style': 'width:100%; font-family:monospace; font-size:12px;',
		'placeholder': isNew
			? _('Required: paste the PRIVATE key of a keypair whose public half is in the remote ~/.ssh/authorized_keys')
			: _('Leave blank to keep the stored key')
	});

	var msg = E('div', { 'style': 'color:red; margin-top:6px;' });
	var saveBtn = E('button', { 'class': 'cbi-button cbi-button-action important' }, [ _('Save') ]);
	var cancelBtn = E('button', { 'class': 'cbi-button', 'click': function() { hostEditor.close(); } }, [ _('Cancel') ]);

	saveBtn.addEventListener('click', function() {
		msg.textContent = '';
		saveBtn.disabled = true;
		var sectName = f || ('zt' + Date.now().toString(36));
		L.resolveDefault(rpcHostSet(
			sectName, nameI.value, hostI.value, portI.value,
			userI.value, cportI.value, keyI.value), {})
		.then(function(res) {
			if (res && res.code === 0) {
				hostEditor.close();
				onSaved();
			} else {
				msg.textContent = errText(res, _('Could not save the host'));
				saveBtn.disabled = false;
			}
		}).catch(function() {
			msg.textContent = _('Could not save the host');
			saveBtn.disabled = false;
		});
	});

	hostEditor.body = E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ isNew ? _('Add a remote host') : _('Edit remote host') ]),
		E('div', { 'class': 'cbi-value' }, [ E('label', {}, [_('Label')]), E('div', {}, [ nameI ]) ]),
		E('div', { 'class': 'cbi-value' }, [ E('label', {}, [_('Public IP or host')]), E('div', {}, [ hostI ]) ]),
		E('div', { 'class': 'cbi-value' }, [ E('label', {}, [_('SSH port')]), E('div', {}, [ portI ]) ]),
		E('div', { 'class': 'cbi-value' }, [ E('label', {}, [_('SSH user')]), E('div', {}, [ userI ]) ]),
		E('div', { 'class': 'cbi-value' }, [ E('label', {}, [_('Controller port')]), E('div', {}, [ cportI, E('div', { 'class': 'cbi-value-description' }, [_('The port the controller API listens on, e.g. 27893. Only reachable through the SSH tunnel.')]) ]) ]),
		E('div', { 'class': 'cbi-value' }, [ E('label', {}, [_('SSH private key')]), E('div', {}, [ keyI ]) ]),
		msg,
		E('div', { 'style': 'margin-top:10px; display:flex; gap:8px;' }, [ saveBtn, cancelBtn ])
	]);
	hostEditor.open();
}

hostEditor.open = function() {
	hostEditor.modal = ui.showModal(_('Remote host'), hostEditor.body);
};
hostEditor.close = function() {
	if (hostEditor.modal) { ui.hideModal(); hostEditor.modal = null; }
};

/* ------------------------------------------------------------- diagnostics */

function diagnostics(section, host) {
	var box = E('div', { 'style': 'margin-top:8px;' });
	var btn = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Run diagnostics') ]);

	function row(k, v) {
		return E('tr', {}, [ E('td', { 'style': 'width:220px;' }, [ k ]), E('td', {}, [ v ]) ]);
	}

	function paint(res) {
		while (box.firstChild) box.removeChild(box.firstChild);
		if (!res || res.code !== 0) {
			box.appendChild(E('div', { 'style': 'color:red;' }, [ errText(res, _('Diagnostics failed')) ]));
			return;
		}
		box.appendChild(E('table', { 'class': 'table' }, [
			E('tr', {}, [ E('th', { 'colspan': '2' }, [_('Remote host report')]) ]),
			row(_('Operating system'), res.os || '-'),
			row(_('Passwordless sudo'), yn(res.sudo, _('yes'), _('no — required'))),
			row(_('ZeroTier installed'), yn(res.zerotier_installed, _('yes'), _('no'))),
			row(_('ZeroTier version'), res.zerotier_version || '-'),
			row(_('Service state'), res.zerotier_service || '-'),
			row(_('Node address'), E('code', {}, [ res.identity || '-' ])),
			row(_('Controller state present'), res.controller_state ? _('yes') : _('no')),
			row(_('Controller reachable via tunnel'), yn(res.controller_reachable, _('yes'), _('no'))),
			row(_('moon.json on host'), res.moon_json_present ? _('yes') : _('no')),
			row(_('Signed .moon files'), String(res.moon_files || 0))
		]));
	}

	btn.addEventListener('click', function() {
		btn.disabled = true;
		btn.textContent = _('Running...');
		while (box.firstChild) box.removeChild(box.firstChild);
		L.resolveDefault(rpcDiagnose(section), {}).then(function(res) {
			paint(res);
			btn.disabled = false;
			btn.textContent = _('Run diagnostics');
		}).catch(function() {
			paint(null);
			btn.disabled = false;
			btn.textContent = _('Run diagnostics');
		});
	});

	return E('div', {}, [ btn, box ]);
}

/* ---------------------------------------------------------------- networks */

function networksPanel(section) {
	var box = E('div', { 'style': 'margin-top:8px;' });
	var refresh = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Refresh') ]);
	var add = E('button', { 'class': 'cbi-button cbi-button-add' }, [ _('Create network') ]);
	var table = E('div', {});

	/* One row of the pool editor. The pool is {ipRangeStart, ipRangeEnd} and
	 * the route needs a CIDR target, so start/end are validated separately. */
	function poolRow(pool, onChange) {
		var s = E('input', { 'type': 'text', 'value': (pool && pool.ipRangeStart) || '', 'placeholder': '192.168.192.1', 'style': 'width:130px;' });
		var e = E('input', { 'type': 'text', 'value': (pool && pool.ipRangeEnd) || '', 'placeholder': '192.168.192.254', 'style': 'width:130px;' });
		var rm = E('button', { 'class': 'cbi-button cbi-button-remove' }, [ _('Remove') ]);
		rm.addEventListener('click', function() { onChange(null, s, e); });
		return { el: E('tr', {}, [
			E('td', {}, [ s ]), E('td', {}, [ e ]),
			E('td', { 'style': 'text-align:right;' }, [ rm ])
		]), start: s, end: e };
	}

	function routeRow(rt, onChange) {
		var t = E('input', { 'type': 'text', 'value': (rt && rt.target) || '', 'placeholder': '192.168.192.0/24', 'style': 'width:150px;' });
		var v = E('input', { 'type': 'text', 'value': (rt && typeof rt.via === 'string') ? rt.via : '', 'placeholder': _('empty = direct'), 'style': 'width:150px;' });
		var rm = E('button', { 'class': 'cbi-button cbi-button-remove' }, [ _('Remove') ]);
		rm.addEventListener('click', function() { onChange(null, t, v); });
		return { el: E('tr', {}, [
			E('td', {}, [ t ]), E('td', {}, [ v ]),
			E('td', { 'style': 'text-align:right;' }, [ rm ])
		]), target: t, via: v };
	}

	function isIp(s) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(function (o) { return +o >= 0 && +o <= 255; }); }
	function isCidr(s) {
		var m = /^([0-9.]+)\/(\d{1,2})$/.exec(s);
		return !!m && isIp(m[1]) && +m[2] >= 0 && +m[2] <= 32;
	}

	function netRow(nw) {
		var name = E('input', { 'type': 'text', 'value': nw.name || '', 'style': 'width:100%;' });
		var bcast = E('input', { 'type': 'checkbox' });
		bcast.checked = !!nw.enableBroadcast;

		var mtu = E('input', { 'type': 'number', 'value': nw.mtu || 2800, 'min': '1280', 'max': '10000', 'style': 'width:90px;' });
		var mlimit = E('input', { 'type': 'number', 'value': (nw.multicastLimit == null ? 32 : nw.multicastLimit), 'min': '0', 'style': 'width:80px;' });
		var priv = E('input', { 'type': 'checkbox' });
		priv.checked = nw.private !== false;

		/* Scalars are merged by the controller (every field is guarded by a
		 * presence check server-side), but routes and ipAssignmentPools are
		 * arrays replaced wholesale -- so those are read, edited here and
		 * written back whole. Verified against 1.14.2 behaviour, not assumed. */
		var pools = (nw.ipAssignmentPools || []).slice();
		var routes = (nw.routes || []).slice();
		var poolTbl = E('tbody', {});
		var routeTbl = E('tbody', {});

		/* drawPools re-renders from the model, so the input references handed
		 * back by poolRow are captured here and used to focus the new row.
		 * Walking childNodes by index would silently break if the table
		 * structure ever changed. */
		var lastPoolInputs = null;
		function drawPools() {
			while (poolTbl.firstChild) poolTbl.removeChild(poolTbl.firstChild);
			lastPoolInputs = null;
			pools.forEach(function (p, i) {
				var r = poolRow(p, function () { pools.splice(i, 1); drawPools(); });
				poolTbl.appendChild(r.el);
				lastPoolInputs = r;
			});
			if (!pools.length) poolTbl.appendChild(E('tr', {}, [ E('td', { 'colspan': '3', 'style': 'color:orange;' }, [ _('No pool — members get no managed address') ]) ]));
		}
		function drawRoutes() {
			while (routeTbl.firstChild) routeTbl.removeChild(routeTbl.firstChild);
			routes.forEach(function (r, i) {
				routeTbl.appendChild(routeRow(r, function () { routes.splice(i, 1); drawRoutes(); }).el);
			});
			if (!routes.length) routeTbl.appendChild(E('tr', {}, [ E('td', { 'colspan': '3', 'style': 'color:orange;' }, [ _('No route') ]) ]));
		}

		function addPool() {
			pools.push({ ipRangeStart: '', ipRangeEnd: '' });
			drawPools();
			if (lastPoolInputs && lastPoolInputs.start.focus) lastPoolInputs.start.focus();
		}
		function addRoute() { routes.push({ target: '', via: null }); drawRoutes(); }

		drawPools(); drawRoutes();

		/* A pool without a route covering the same subnet leaves members with
		 * no address: the pool is allocated but never installed, and the member
		 * list then shows no IP with no indication why. Reads the live input
		 * values so it reflects unsaved edits. */
		function poolWarning() {
			var rows = poolTbl.childNodes, nets = [], i, j;
			for (i = 0; i < rows.length; i++) {
				var s = rows[i].childNodes[0] && rows[i].childNodes[0].childNodes[0];
				if (!s) continue;
				var sv = (s.value || '').trim();
				if (!sv || !isIp(sv)) continue;
				nets.push(sv.split('.').slice(0, 3).join('.') + '.0/24');
			}
			if (!nets.length) return null;
			var rrows = routeTbl.childNodes, targets = [];
			for (j = 0; j < rrows.length; j++) {
				var t = rrows[j].childNodes[0] && rrows[j].childNodes[0].childNodes[0];
				if (t && (t.value || '').trim()) targets.push(t.value.trim());
			}
			for (i = 0; i < nets.length; i++) {
				if (targets.indexOf(nets[i]) === -1) {
					return _('No route covers ') + nets[i] +
						_(' — members will not receive an address from this pool.');
				}
			}
			return null;
		}

		var save = E('button', { 'class': 'cbi-button cbi-button-apply' }, [ _('Save') ]);
		save.addEventListener('click', function() {
			var warn = poolWarning();
			if (warn && !confirm(warn + '\n\n' + _('Save anyway?'))) return;

			var newPools = [], newRoutes = [], bad = null;
			poolTbl.childNodes.forEach(function (tr) {
				var s = tr.childNodes[0] && tr.childNodes[0].childNodes[0];
				var e = tr.childNodes[1] && tr.childNodes[1].childNodes[0];
				if (!s || !e) return;
				var sv = (s.value || '').trim(), ev = (e.value || '').trim();
				if (!sv && !ev) return;
				if (!isIp(sv) || !isIp(ev)) { bad = _('Pool bounds must be IPv4 addresses'); return; }
				newPools.push({ ipRangeStart: sv, ipRangeEnd: ev });
			});
			if (bad) { ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ bad ]), 'warning'); return; }

			routeTbl.childNodes.forEach(function (tr) {
				var t = tr.childNodes[0] && tr.childNodes[0].childNodes[0];
				var v = tr.childNodes[1] && tr.childNodes[1].childNodes[0];
				if (!t) return;
				var tv = (t.value || '').trim(), vv = (v && v.value || '').trim();
				if (!tv) return;
				if (!isCidr(tv)) { bad = _('Route target must be CIDR, e.g. 192.168.192.0/24'); return; }
				if (vv && !isIp(vv)) { bad = _('Route via must be an IPv4 address, or empty for a direct route'); return; }
				newRoutes.push({ target: tv, via: vv || null });
			});
			if (bad) { ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ bad ]), 'warning'); return; }

			/* v4AssignMode.zt must be enabled for a pool to hand out addresses at
			 * all -- with it false the pool is stored but nothing is allocated,
			 * silently. Verified on 1.14.2: identical pool+routes produce
			 * ipAssignments:[] without it and a real address with it. Sent
			 * unconditionally so a cleared pool also switches assignment off
			 * rather than leaving it dangling.
			 *
			 * The object form is required. The published tutorial shows the
			 * string "zt", but the schema defines an object and the daemon
			 * ignores a wrongly-typed field without complaint. */
			var body = JSON.stringify({
				name: name.value,
				enableBroadcast: bcast.checked,
				private: priv.checked,
				mtu: parseInt(mtu.value, 10) || 2800,
				multicastLimit: parseInt(mlimit.value, 10) || 0,
				ipAssignmentPools: newPools,
				routes: newRoutes,
				v4AssignMode: { zt: newPools.length > 0 }
			});

			save.disabled = true;
			L.resolveDefault(rpcNetSet(section, nw.nwid, body), {}).then(function(res) {
				if (res && res.code === 200) load();
				else ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ errText(res, _('Update failed')) ]), 'warning');
				save.disabled = false;
			});
		});

		var del = E('button', {
			'class': 'cbi-button cbi-button-remove',
			'click': function() {
				if (!confirm(_('Delete network ') + nw.nwid + '? Members will lose connectivity.')) return;
				del.disabled = true;
				L.resolveDefault(rpcNetDel(section, nw.nwid), {}).then(function(res) {
					if (res && res.code === 0) load();
					else ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ errText(res, _('Delete failed')) ]), 'warning');
					del.disabled = false;
				});
			}
		}, [ _('Delete') ]);

		var members = E('div', { 'style': 'margin-top:6px; padding-left:12px;' });
		var mToggle = E('button', { 'class': 'cbi-button' }, [ _('Members') ]);
		mToggle.addEventListener('click', function() {
			if (members.firstChild) { while (members.firstChild) members.removeChild(members.firstChild); return; }
			loadMembers(nw.nwid, members);
		});

		var cfg = E('div', { 'style': 'margin-top:8px; padding-left:12px;' }, [
			E('div', { 'style': 'display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:6px;' }, [
				E('label', {}, [ _('MTU')]), mtu,
				E('label', {}, [ _('Multicast limit')]), mlimit,
				E('label', {}, [ _('Private')]), priv
			]),
			E('div', { 'style': 'font-weight:bold; margin-top:6px;' }, [ _('IP assignment pools') ]),
			E('div', { 'style': 'color:#666; font-size:12px;' }, [
				_('The controller allocates addresses from these ranges and reports them per member.')
			]),
			E('table', { 'class': 'table' }, [
				E('tr', {}, [ E('th', {}, [_('First IP')]), E('th', {}, [_('Last IP')]), E('th', {}) ]),
				poolTbl
			]),
			E('button', { 'class': 'cbi-button cbi-button-add', 'click': addPool }, [ _('Add pool') ]),
			E('div', { 'style': 'font-weight:bold; margin-top:10px;' }, [ _('Routes') ]),
			E('div', { 'style': 'color:#666; font-size:12px;' }, [
				_('A pool needs a route covering the same subnet, otherwise members receive no address.')
			]),
			E('table', { 'class': 'table' }, [
				E('tr', {}, [ E('th', {}, [_('Target')]), E('th', {}, [_('Via')]), E('th', {}) ]),
				routeTbl
			]),
			E('button', { 'class': 'cbi-button cbi-button-add', 'click': addRoute }, [ _('Add route') ])
		]);
		var cToggle = E('button', { 'class': 'cbi-button' }, [ _('Configure') ]);
		cToggle.addEventListener('click', function() {
			if (cfg.style.display === 'none') { cfg.style.display = 'block'; cToggle.textContent = _('Hide'); }
			else { cfg.style.display = 'none'; cToggle.textContent = _('Configure'); }
		});
		cfg.style.display = 'none';

		return E('tr', {}, [
			E('td', { 'style': 'font-family:monospace;' }, [ nw.nwid ]),
			E('td', {}, [ name ]),
			E('td', { 'style': 'text-align:center;' }, [ bcast ]),
			E('td', { 'style': 'text-align:right; white-space:nowrap;' }, [ save, ' ', cToggle, ' ', mToggle, ' ', del ]),
			E('td', { 'colspan': '4' }, [ cfg, members ])
		]);
	}

	function loadMembers(nwid, into) {
		into.appendChild(E('div', { 'style': 'color:orange;' }, [ _('Loading...') ]));
		L.resolveDefault(rpcCtlGet(section, '/controller/network/' + nwid + '/member'), {}).then(function(res) {
			while (into.firstChild) into.removeChild(into.firstChild);
			var body = (res && res.body) || {};
			if (res && res.code !== 200) {
				into.appendChild(E('div', { 'style': 'color:red;' }, [ errText(res, _('Could not list members')) ]));
				return;
			}
			var idI = E('input', { 'type': 'text', 'placeholder': _('Node address (10 hex)'), 'style': 'width:180px;' });
			var authBtn = E('button', { 'class': 'cbi-button cbi-button-add' }, [ _('Authorize') ]);
			authBtn.addEventListener('click', function() {
				var mid = idI.value.trim();
				if (!/^[0-9a-fA-F]{10}$/.test(mid)) {
					ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ _('A node address is exactly 10 hex digits') ]), 'warning');
					return;
				}
				authBtn.disabled = true;
				var body2 = JSON.stringify({ authorized: true, activeBridge: false, capability: null, id: mid, name: '', nodeId: mid });
				L.resolveDefault(rpcMemberSet(section, nwid, mid, body2), {}).then(function(r2) {
					if (r2 && r2.code === 0) { idI.value = ''; loadMembers(nwid, into); }
					else ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ errText(r2, _('Authorize failed')) ]), 'warning');
					authBtn.disabled = false;
				});
			});

			into.appendChild(E('div', { 'style': 'display:flex; gap:6px; align-items:center; margin:6px 0;' }, [ idI, authBtn ]));

			var ids = Object.keys(body);
			if (!ids.length) {
				into.appendChild(E('div', { 'style': 'color:orange;' }, [ _('No members have joined this network yet.') ]));
				return;
			}
			var hdr = E('tr', {}, [
				E('th', {}, [_('Node address')]),
				E('th', {}, [_('Name')]),
				E('th', {}, [_('Managed IP')]),
				E('th', {}, [_('Version')]),
				E('th', {}, [_('Authorized')]),
				E('th', {})
			]);
			var rows = [ hdr ];
			var tbl = E('table', { 'class': 'table' }, rows);
			into.appendChild(tbl);

			/* The member list returns only {id: revision}; every real field
			 * (name, managed IP, version, authorization) needs a per-member
			 * GET. Chained rather than parallel on purpose: each call opens an
			 * SSH tunnel, and firing 30 at once would hammer the router. Each
			 * row is appended as it resolves so the table fills in progressively. */
			function appendMember(i) {
				if (i >= ids.length) return;
				var mid = ids[i];
				L.resolveDefault(rpcCtlGet(section, '/controller/network/' + nwid + '/member/' + mid), {}).then(function(d) {
					var m = (d && d.code === 200 && d.body) ? d.body : {};
					var ips = m.ipAssignments || [];
					var ver = (m.vMajor != null && m.vMajor >= 0) ? (m.vMajor + '.' + (m.vMinor || 0)) : '-';

					var nameI = E('input', { 'type': 'text', 'value': m.name || '', 'style': 'width:100%;' });
					var authC = E('input', { 'type': 'checkbox' });
					authC.checked = !!m.authorized;
					var saveB = E('button', { 'class': 'cbi-button cbi-button-apply' }, [ _('Save') ]);
					saveB.addEventListener('click', function() {
						saveB.disabled = true;
						var b = JSON.stringify({
							name: nameI.value,
							authorized: authC.checked,
							activeBridge: !!m.activeBridge,
							ipAssignments: ips,
							noAutoAssignIps: !!m.noAutoAssignIps
						});
						L.resolveDefault(rpcMemberSet(section, nwid, mid, b), {}).then(function(r2) {
							if (r2 && r2.code === 0) loadMembers(nwid, into);
							else ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ errText(r2, _('Update failed')) ]), 'warning');
							saveB.disabled = false;
						});
					});

					var revoke = E('button', { 'class': 'cbi-button cbi-button-remove' }, [ _('Delete') ]);
					revoke.addEventListener('click', function() {
						if (!confirm(_('Remove member ') + mid + ' from this network?')) return;
						revoke.disabled = true;
						L.resolveDefault(rpcMemberSet(section, nwid, mid, JSON.stringify({
							name: '', authorized: false, activeBridge: false, ipAssignments: [], noAutoAssignIps: false
						})), {}).then(function() { loadMembers(nwid, into); });
					});

					tbl.appendChild(E('tr', {}, [
						E('td', { 'style': 'font-family:monospace;' }, [ mid ]),
						E('td', {}, [ nameI ]),
						/* An empty ipAssignments with version -1 means the node has
						 * never come up on this network, so there is genuinely no
						 * address to show. Saying so beats a blank cell that looks
						 * like a loading failure. */
						E('td', { 'style': 'font-family:monospace;' }, ips.length
							? [ ips.join(', ') ]
							: [ E('span', { 'style': 'color:orange;' }, [
								(m.vMajor != null && m.vMajor < 0)
									? _('never connected')
									: _('no pool assigned')
							]) ]),
						E('td', {}, [ ver ]),
						E('td', { 'style': 'text-align:center;' }, [ authC ]),
						E('td', { 'style': 'text-align:right; white-space:nowrap;' }, [ saveB, ' ', revoke ])
					]));
					appendMember(i + 1);
				});
			}
			appendMember(0);
		});
	}

	function load() {
		while (table.firstChild) table.removeChild(table.firstChild);
		table.appendChild(E('div', { 'style': 'color:orange;' }, [ _('Loading...') ]));
		L.resolveDefault(rpcCtlGet(section, '/controller/network'), {}).then(function(res) {
			while (table.firstChild) table.removeChild(table.firstChild);
			if (res && res.code !== 200) {
				table.appendChild(E('div', { 'style': 'color:red;' }, [ errText(res, _('Could not reach the controller')) ]));
				return;
			}
			var ids = Array.isArray(res.body) ? res.body : [];
			if (!ids.length) {
				table.appendChild(E('div', { 'style': 'color:orange;' }, [ _('This controller has no networks yet.') ]));
				return;
			}
			var head = E('tr', {}, [
				E('th', {}, [_('Network ID')]), E('th', {}, [_('Name')]),
				E('th', { 'style': 'text-align:center;' }, [_('Broadcast')]),
				E('th', { 'style': 'text-align:right;' }, [_('Actions')]), E('th', {})
			]);
			var body = [ head ];
			ids.forEach(function(nwid) {
				L.resolveDefault(rpcCtlGet(section, '/controller/network/' + nwid), {}).then(function(d) {
					if (d && d.code === 200 && d.body) body.push(netRow(d.body));
					if (body.length === ids.length + 1) {
						table.appendChild(E('table', { 'class': 'table' }, body));
					}
				});
			});
		});
	}

	refresh.addEventListener('click', load);
	add.addEventListener('click', function() {
		add.disabled = true;
		L.resolveDefault(rpcNetSet(section, 'new', '{}'), {}).then(function(res) {
			if (res && res.code === 200) load();
			else ui.addNotification(null, E('span', { 'class': 'alert-message warning' }, [ errText(res, _('Create failed')) ]), 'warning');
			add.disabled = false;
		});
	});

	load();
	return E('div', {}, [ E('div', { 'style': 'display:flex; gap:8px; margin-top:8px;' }, [ refresh, add ]), table ]);
}

/* -------------------------------------------------------------------- moon */

function moonPanel(section) {
	var box = E('div', { 'style': 'margin-top:8px;' });
	var planBtn = E('button', { 'class': 'cbi-button' }, [ _('Show plan') ]);

	function showPlan(res) {
		while (box.firstChild) box.removeChild(box.firstChild);
		if (!res || res.code !== 0) {
			box.appendChild(E('div', { 'style': 'color:red;' }, [ errText(res, _('Could not build a plan')) ]));
			return;
		}
		var go = E('button', { 'class': 'cbi-button cbi-button-action important' }, [ _('Create and sign the moon') ]);
		go.addEventListener('click', function() {
			if (!confirm(_('This will create moon.json (holding the signing secret) and a signed .moon on the remote host. Continue?'))) return;
			go.disabled = true;
			L.resolveDefault(rpcMoonApply(section, res.confirm), {}).then(function(r2) {
				go.disabled = false;
				while (box.firstChild) box.removeChild(box.firstChild);
				if (!r2 || r2.code !== 0) {
					box.appendChild(E('div', { 'style': 'color:red;' }, [ errText(r2, _('Moon creation failed')) ]));
					return;
				}
				var href = 'data:application/octet-stream;base64,' + r2.moon_b64;
				box.appendChild(E('div', { 'style': 'color:green; margin-bottom:6px;' }, [
					_('Moon created: '), E('code', {}, [ r2.moon_id ]), ' — ',
					E('a', { 'href': href, 'download': r2.moon_file || (r2.moon_id + '.moon'), 'class': 'cbi-button' }, [ _('Download .moon') ])
				]));
				box.appendChild(E('div', { 'style': 'color:orange;' }, [
					_('Distribute this file to members, then use Interface Info → Moons → Add Moon on each node. The signing secret never left the remote host.')
				]));
			});
		});

		box.appendChild(E('div', { 'style': 'margin:6px 0;' }, [
			E('div', {}, [ _('The following will run on the remote host:') ]),
			E('pre', { 'style': 'background:#f4f4f4; padding:8px; overflow:auto; font-size:12px;' }, [ res.script ])
		]));
		box.appendChild(E('div', { 'style': 'color:orange; margin-bottom:6px;' }, [ res.notes ]));
		box.appendChild(go);
	}

	planBtn.addEventListener('click', function() {
		planBtn.disabled = true;
		planBtn.textContent = _('Building...');
		L.resolveDefault(rpcMoonPlan(section), {}).then(function(res) {
			showPlan(res);
			planBtn.disabled = false;
			planBtn.textContent = _('Show plan');
		}).catch(function() {
			showPlan(null);
			planBtn.disabled = false;
			planBtn.textContent = _('Show plan');
		});
	});

	return E('div', {}, [
		planBtn,
		E('div', { 'style': 'color:orange; margin-top:4px;' }, [
			_('The remote host becomes the single root of a new moon. Additional roots are not supported yet.')
		]),
		box
	]);
}

/* --------------------------------------------------------------------- page */

return view.extend({
	load: function() {
		return Promise.all([ uci.load('zerotier') ]);
	},

	render: function() {
		var listBox = E('div', {});

		function reload() {
			L.resolveDefault(rpcHostList(), {}).then(function(res) {
				while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
				var hosts = (res && res.hosts) || [];
				if (!hosts.length) {
					listBox.appendChild(E('div', { 'style': 'color:orange;' }, [
						_('No remote hosts configured yet. Add one to manage a Controller or Moon that runs on a separate server.')
					]));
					return;
				}
				hosts.forEach(function(h) {
					var detail = E('div', { 'style': 'display:none; margin:8px 0 16px 0; padding-left:12px; border-left:3px solid #ccc;' });
					var toggle = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Manage') ]);
					toggle.addEventListener('click', function() {
						/* A freshly created div has display '', not 'none', so the
						 * open test has to be for 'block' -- testing "!== 'none'"
						 * reads the initial state as already-open and the first
						 * click collapses the panel instead of building it. */
						var isOpen = detail.style.display === 'block';
						detail.style.display = isOpen ? 'none' : 'block';
						toggle.textContent = isOpen ? _('Manage') : _('Hide');
						if (!isOpen && !detail.firstChild) {
							detail.appendChild(E('h4', {}, [_('Diagnostics')]));
							detail.appendChild(diagnostics(h.section, h));
							detail.appendChild(E('h4', {}, [_('Networks')]));
							detail.appendChild(networksPanel(h.section));
							detail.appendChild(E('h4', {}, [_('Moon')]));
							detail.appendChild(moonPanel(h.section));
						}
					});

					var edit = E('button', { 'class': 'cbi-button' }, [ _('Edit') ]);
					edit.addEventListener('click', function() { hostEditor(h.section, h, reload); });

					var del = E('button', { 'class': 'cbi-button cbi-button-remove' }, [ _('Delete') ]);
					del.addEventListener('click', function() {
						if (!confirm(_('Remove ') + h.name + ' from this router? The remote host is not modified.')) return;
						del.disabled = true;
						L.resolveDefault(rpcHostDel(h.section), {}).then(function() { reload(); });
					});

					listBox.appendChild(E('div', { 'class': 'cbi-section' }, [
						E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;' }, [
							E('div', {}, [
								E('strong', {}, [ h.name ]),
								E('div', { 'style': 'font-family:monospace; font-size:12px; color:#666;' }, [
									h.user + '@' + h.host + ':' + h.port + _(' (controller port ') + h.controller_port + ')'
								]),
								h.key_present
									? E('div', { 'style': 'font-size:12px; color:green;' }, [_('SSH key installed')])
									: E('div', { 'style': 'font-size:12px; color:red;' }, [_('No SSH key — add one before use')])
							]),
							E('div', { 'style': 'display:flex; gap:6px;' }, [ toggle, edit, del ])
						]),
						detail
					]));
				});
			});
		}

		var addBtn = E('button', { 'class': 'cbi-button cbi-button-add' }, [ _('Add remote host') ]);
		addBtn.addEventListener('click', function() { hostEditor(null, null, reload); });

		reload();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('ZeroTier'), ' - ', _('Remote Controller') ]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [_('How remote management works')]),
				E('div', { 'style': 'margin-bottom:8px;' }, [
					E('p', {}, [ _('A ZeroTier controller or moon root must live on a server with a fixed public IP, reachable by SSH, with passwordless sudo for that user. The controller API has no TLS and refuses every non-loopback caller, so this page never talks to it directly: it opens an SSH tunnel from this router to the remote loopback interface and sends API calls through it. The controller authtoken is read over SSH on demand and is never stored here.') ])
				]),
				E('div', { 'style': 'background:#f4f4f4; padding:8px; font-size:12px; font-family:monospace;' }, [
					_('Requirements: a fixed public IP · SSH access · a keypair whose public key is in the remote authorized_keys · passwordless sudo · ZeroTier built with the controller (1.14.2 or the 1.16 nonfree build)')
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [_('Configured hosts')]),
				listBox,
				E('div', { 'style': 'margin-top:10px;' }, [ addBtn ])
			])
		]);
	}
});
