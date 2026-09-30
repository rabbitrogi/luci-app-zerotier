'use strict';
'require view';
'require ui';
'require poll';
'require rpc';

var callLuciZerotierIdentity = rpc.declare({
	object: 'luci-zerotier',
	method: 'get_identity'
});

var callLuciZerotierNetworks = rpc.declare({
	object: 'luci-zerotier',
	method: 'get_networks'
});

var callLuciZerotierPeers = rpc.declare({
	object: 'luci-zerotier',
	method: 'get_peers'
});

var callLuciZerotierPing = rpc.declare({
	object: 'luci-zerotier',
	method: 'ping_networks'
});

var callLuciZerotierListMoons = rpc.declare({
	object: 'luci-zerotier',
	method: 'list_moons'
});

var callLuciZerotierOrbitMoon = rpc.declare({
	object: 'luci-zerotier',
	method: 'orbit_moon',
	params: ['moon_id', 'seed']
});

var callLuciZerotierDeorbitMoon = rpc.declare({
	object: 'luci-zerotier',
	method: 'deorbit_moon',
	params: ['moon_id']
});

	// Called with no argument it falls back to the committed local_conf_path,
	// i.e. it does exactly what the "Backup Now" button does.
var callLuciZerotierSync = rpc.declare({
	object: 'luci-zerotier',
	method: 'sync_config'
});

return view.extend({
	load: function() {
		return Promise.resolve();
	},

	render: function() {
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [_('ZeroTier'), ' - ', _('Interface Info')]),
			E('div', { 'class': 'cbi-section', 'id': 'zt_info_section' }, [
				E('div', { 'id': 'zt_identity', 'style': 'margin-bottom: 10px;' }),
				E('div', { 'id': 'zt_actions', 'style': 'margin-bottom: 10px; display: flex; align-items: center; gap: 10px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-action important',
						'id': 'zt_ping_btn',
						'click': function() {
							var btn = document.getElementById('zt_ping_btn');
							var statusEl = document.getElementById('zt_ping_status');
							var resultEl = document.getElementById('zt_ping_result');
							if (btn && !btn.disabled) {
								btn.disabled = true;
								btn.textContent = _('Pinging...');
								if (statusEl) {
									statusEl.textContent = '';
								}
								if (resultEl) {
									while (resultEl.firstChild) {
										resultEl.removeChild(resultEl.firstChild);
									}
								}
								L.resolveDefault(callLuciZerotierPing(), {}).then(function(res) {
									if (statusEl) {
										if (res && res.result && res.result !== 'no_result') {
											var lines = res.result.split('|');
											var okCount = 0;
											var displayLines = [];
											for (var i = 0; i < lines.length; i++) {
												var line = lines[i].trim();
												if (!line) continue;
												if (line.indexOf('OK:') === 0) {
													okCount++;
													displayLines.push(line.substring(3));
												}
											}
										statusEl.style.color = okCount > 0 ? 'green' : 'orange';
										statusEl.textContent = _('Online') + ': ' + okCount;

										if (resultEl) {
											while (resultEl.firstChild) {
												resultEl.removeChild(resultEl.firstChild);
											}
											if (okCount > 0) {
												var gridEl = E('div', {
													'style': 'display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px;'
												});
												for (var j = 0; j < displayLines.length; j++) {
													gridEl.appendChild(E('span', {
														'style': 'font-family: monospace; font-size: 12px; padding: 2px 6px;'
													}, [displayLines[j]]));
												}
												resultEl.appendChild(gridEl);
											}
										}
									} else {
										if (res && res.stderr === 'scan already in progress') {
											statusEl.style.color = 'orange';
											statusEl.textContent = _('Scan already in progress, please wait');
										} else {
											statusEl.textContent = res && res.stderr ? res.stderr : _('No IPs to ping');
										}
									}
									}
								if (btn) {
									btn.disabled = false;
									btn.textContent = _('Ping All');
								}
							}).catch(function(err) {
								if (statusEl) {
									statusEl.textContent = _('Error');
								}
								if (btn) {
									btn.disabled = false;
									btn.textContent = _('Ping All');
								}
							});
							}
						}
					}, [_('Ping All')]),
					E('span', { 'id': 'zt_ping_status', 'style': 'margin-left: 10px;' }),
				]),
				E('div', { 'id': 'zt_ping_result' }),
				E('h3', {}, _('Networks')),
				E('div', { 'id': 'zt_networks' }, [
					E('em', {}, [_('Loading...')])
				]),
				E('h3', { 'style': 'margin-top: 16px;' }, _('Peers')),
				E('div', { 'id': 'zt_peers' }, [
					E('em', {}, [_('Loading...')])
				]),
				E('h3', { 'style': 'margin-top: 16px;' }, _('Moons')),
				E('div', {
					'style': 'color: #888; font-size: 12px; margin-bottom: 8px;'
				}, [_('Orbiting a moon adds its roots to this node\'s root set. ZeroTier keeps using the planetary roots as fallback. Note that upstream ZeroTier no longer recommends private moons and does not support them under its SLA.')]),
				E('div', { 'id': 'zt_moon_actions', 'style': 'margin-bottom: 10px; display: flex; align-items: center; gap: 10px;' }, [
					E('button', {
						'class': 'cbi-button cbi-button-add',
						'id': 'zt_moon_add_btn',
						'click': function() {
							var f = document.getElementById('zt_moon_form');
							if (f) f.style.display = (f.style.display === 'none' || !f.style.display) ? 'block' : 'none';
						}
					}, [_('Add Moon')]),
					E('span', { 'id': 'zt_moon_status' })
				]),
				E('div', { 'id': 'zt_moon_form', 'style': 'display: none; margin-bottom: 10px;' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('Moon ID')]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'type': 'text',
								'id': 'zt_moon_id',
								'class': 'cbi-input-text',
								'placeholder': '123456abcd'
							})
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [_('Moon Seed')]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'type': 'text',
								'id': 'zt_moon_seed',
								'class': 'cbi-input-text',
								'placeholder': '1a2b3c4d5e'
							}),
							E('div', { 'style': 'color: #888; font-size: 11px;' }, [_('The 10-digit address of one of the moon\'s roots. ZeroTier fetches the moon definition from it.')])
						])
					]),
					E('div', { 'style': 'display: flex; gap: 8px;' }, [
						E('button', {
							'class': 'cbi-button cbi-button-apply important',
							'id': 'zt_moon_add_submit',
							'click': function() {
								var btn = document.getElementById('zt_moon_add_submit');
								var statusEl = document.getElementById('zt_moon_status');
								var idEl = document.getElementById('zt_moon_id');
								var seedEl = document.getElementById('zt_moon_seed');
								if (!btn || btn.disabled || !idEl || !seedEl) return;

								var id = (idEl.value || '').trim();
								var seed = (seedEl.value || '').trim();

								var fail = function(msg) {
									if (statusEl) {
										statusEl.style.color = 'red';
										statusEl.textContent = msg;
									}
								};

								if (!/^[0-9a-fA-F]{1,16}$/.test(id.replace(/^0+(?=.)/, '')) || !/[1-9a-fA-F]/.test(id)) {
									return fail(_('Moon ID must be 10 hexadecimal digits (e.g. 123456abcd)'));
								}
								if (!/^[0-9a-fA-F]{10}$/.test(seed) || !/[1-9a-fA-F]/.test(seed)) {
									return fail(_('Moon Seed must be the 10-digit address of one of the moon\'s roots'));
								}

								btn.disabled = true;
								btn.textContent = _('Orbiting...');
								if (statusEl) {
									statusEl.style.color = 'orange';
									statusEl.textContent = _('Registering the orbit...');
								}

								L.resolveDefault(callLuciZerotierOrbitMoon(id, seed), {}).then(function(res) {
									if (res && res.code === 0) {
										if (statusEl) {
											if (res.pending) {
												statusEl.style.color = 'orange';
												statusEl.textContent = _('Orbit registered. The moon definition is still being fetched from the seed - it will appear below once it arrives.');
											} else {
												statusEl.style.color = 'green';
												statusEl.textContent = _('Orbited Moon') + ' ' + (res.moon_id || id);
											}
										}
										idEl.value = '';
										seedEl.value = '';
										var f = document.getElementById('zt_moon_form');
										if (f) f.style.display = 'none';
										updateMoons();
									} else {
										fail((res && res.stderr) ? res.stderr : _('Orbit failed'));
									}
								}).catch(function() {
									fail(_('Orbit request failed'));
								}).finally(function() {
									btn.disabled = false;
									btn.textContent = _('Add');
								});
							}
						}, [_('Add')]),
						E('button', {
							'class': 'cbi-button cbi-button-reset',
							'click': function() {
								var f = document.getElementById('zt_moon_form');
								if (f) f.style.display = 'none';
							}
						}, [_('Cancel')])
					])
				]),
				E('div', { 'id': 'zt_moons' }, [
					E('em', {}, [_('Loading...')])
				])
			])
		]);

		var parseNetworks = function(jsonStr) {
			if (!jsonStr || typeof jsonStr !== 'string') return [];
			try {
				var arr = JSON.parse(jsonStr);
				if (!Array.isArray(arr)) return [];
				return arr.map(function(net) {
					return {
						nwid: net.nwid || net.id || '-',
						name: net.name || '-',
						mac: net.mac || '-',
						status: net.status || '-',
						type: net.type || '-',
						dev: net.portDeviceName || '-',
						ips: (net.assignedAddresses || []).join(' ') || '-'
					};
				});
			} catch(e) {
				return [];
			}
		};

		var parsePeers = function(jsonStr) {
			if (!jsonStr || typeof jsonStr !== 'string') return [];
			try {
				var arr = JSON.parse(jsonStr);
				if (!Array.isArray(arr)) return [];
				return arr.map(function(peer) {
					var path = '-';
					var link = '-';
					if (peer.paths && peer.paths.length > 0) {
						for (var i = 0; i < peer.paths.length; i++) {
							if (peer.paths[i].active) {
								path = peer.paths[i].address || '-';
								break;
							}
						}
					}
					if (peer.tunneled) {
						link = 'RELAY';
					} else if (path !== '-') {
						link = 'DIRECT';
					}
					return {
						ztaddr: peer.address || '-',
						version: peer.version || '-',
						role: peer.role || '-',
						latency: (peer.latency != null && peer.latency >= 0) ? String(peer.latency) : '-',
						link: link,
						path: path
					};
				});
			} catch(e) {
				return [];
			}
		};

		var getStatusColor = function(status) {
			if (status && status.toLowerCase().indexOf('ok') >= 0) {
				return 'green';
			} else if (status && status.toLowerCase().indexOf('error') >= 0) {
				return 'red';
			} else if (status && status.toLowerCase().indexOf('request') >= 0) {
				return 'orange';
			}
			return 'gray';
		};

		var getRoleColor = function(role) {
			if (role === 'PLANET') {
				return '#8B4513';
			} else if (role === 'MOON') {
				return '#4169E1';
			} else if (role === 'LEAF') {
				return 'green';
			}
			return 'gray';
		};

		var getLinkColor = function(link) {
			if (link === 'DIRECT') {
				return 'green';
			} else if (link === 'RELAY') {
				return 'orange';
			}
			return 'gray';
		};

		var clearElement = function(el) {
			while (el.firstChild) {
				el.removeChild(el.firstChild);
			}
		};

		// The daemon's control-plane route is /moon/([0-9a-fA-F]{10}) -- exactly
		// ten -- while listmoons reports ids zero-padded to 16. Normalize to the
		// 10-digit form for display and for orbit/deorbit. Mirrors moon_norm_id().
		var normMoonId = function(id) {
			var s = (id || '').toLowerCase().replace(/[^0-9a-f]/g, '');
			s = s.replace(/^0+/, '');
			if (s === '') s = '0';
			while (s.length < 10) s = '0' + s;
			return s;
		};

		var parseMoons = function(jsonStr) {
			if (!jsonStr || typeof jsonStr !== 'string') return null;
			try {
				var arr = JSON.parse(jsonStr);
				if (!Array.isArray(arr)) return null;
				return arr.map(function(m) {
					var roots = Array.isArray(m.roots) ? m.roots : [];
					var eps = [];
					var rootAddrs = [];
					roots.forEach(function(r) {
						var ident = (r && r.identity) ? String(r.identity) : '';
						// wire format is "<10 hex address>:0:<pubkey>"
						var am = ident.match(/^([0-9a-fA-F]{10}):/);
						if (am) rootAddrs.push(am[1].toLowerCase());
						((r && r.stableEndpoints) || []).forEach(function(e) {
							eps.push(String(e));
						});
					});
					return {
						id: normMoonId(m.id),
						roots: roots.length,
						rootAddresses: rootAddrs,
						endpoints: eps,
						waiting: m.waiting === true
					};
				});
			} catch (e) {
				return null;
			}
		};

		var persistedMoonSet = function(str) {
			var set = {};
			(String(str || '').split(/\s+/)).forEach(function(p) {
				if (!p) return;
				var s = p.toLowerCase().replace(/^0+/, '');
				set[s === '' ? '0' : s] = true;
			});
			return set;
		};

		var createMoonTable = function(moons, persisted) {
			var table = E('table', {
				class: 'cbi-section-table',
				style: 'width: 100%; border-collapse: collapse;'
			});

			var header = E('tr', { class: 'cbi-section-table-titles' });
			var headers = [_('Moon ID'), _('Roots'), _('Endpoints'), _('Storage'), _('Actions')];
			for (var h = 0; h < headers.length; h++) {
				header.appendChild(E('th', { style: 'text-align: left; padding: 4px;' }, [headers[h]]));
			}
			table.appendChild(header);

			moons.forEach(function(moon) {
				var row = E('tr', { class: 'cbi-section-table-row' });

				var idTd = E('td', { style: 'text-align: left; padding: 4px;' });
				idTd.appendChild(E('code', {}, [moon.id]));
				if (moon.waiting) {
					idTd.appendChild(E('div', {
						style: 'color: orange; font-size: 11px;'
					}, [_('waiting for the moon definition - this orbit is not persistent yet')]));
				}
				row.appendChild(idTd);

				var rootsTd = E('td', { style: 'text-align: left; padding: 4px;' });
				rootsTd.appendChild(E('span', {}, [String(moon.roots)]));
				if (moon.rootAddresses.length) {
					rootsTd.appendChild(E('div', {
						style: 'font-family: monospace; font-size: 11px; color: #888;'
					}, [moon.rootAddresses.join(', ')]));
				}
				row.appendChild(rootsTd);

				row.appendChild(E('td', {
					style: 'text-align: left; padding: 4px; font-family: monospace; font-size: 11px;'
				}, [moon.endpoints.length ? moon.endpoints.join(', ') : '-']));

				var isPersisted = !!persisted[moon.id];
				var stTd = E('td', { style: 'text-align: left; padding: 4px;' });
				stTd.appendChild(E('span', {
					style: 'color: ' + (isPersisted ? 'green' : 'orange')
				}, [isPersisted ? _('persistent') : _('saving...')]));
				if (!isPersisted) {
					stTd.appendChild(E('div', {
						style: 'font-size: 11px; color: #888;'
					}, [_('Saving to the persistent folder automatically. Until then the orbit is lost on daemon restart. If it stays in this state, use "Backup Now" under Settings -> Advanced options.')]));
				}
				row.appendChild(stTd);

				var actTd = E('td', { style: 'text-align: left; padding: 4px;' });
				actTd.appendChild(E('button', {
					'class': 'cbi-button cbi-button-remove',
					'click': function() {
						var statusEl = document.getElementById('zt_moon_status');
						if (statusEl) {
							statusEl.style.color = 'orange';
							statusEl.textContent = _('Leaving moon...');
						}
						L.resolveDefault(callLuciZerotierDeorbitMoon(moon.id), {}).then(function(res) {
							if (statusEl) {
								if (res && res.code === 0 && res.deorbited) {
									statusEl.style.color = 'green';
									statusEl.textContent = _('Left Moon') + ' ' + moon.id;
								} else if (res && res.code === 0) {
									statusEl.style.color = 'orange';
									statusEl.textContent = res.stderr || _('Moon was not orbited');
								} else {
									statusEl.style.color = 'red';
									statusEl.textContent = res && res.stderr ? res.stderr : _('Deorbit failed');
								}
							}
							updateMoons();
						}).catch(function() {
							if (statusEl) {
								statusEl.style.color = 'red';
								statusEl.textContent = _('Deorbit request failed');
							}
						});
					}
				}, [_('Leave')]));
				row.appendChild(actTd);

				table.appendChild(row);
			});

			return table;
		};

		var moonSyncTries = {};
		var moonSyncBusy = false;

		// A moon only becomes persistent once its signed world has landed in
		// moons.d. orbit_moon syncs on the spot when the definition is already
		// there, but a definition that arrives later (the pending case) is
		// picked up here instead, so the user never has to hunt for the
		// "Backup Now" button on the other page.
		var autoPersistMoons = function() {
			if (moonSyncBusy) return;
			moonSyncBusy = true;
			L.resolveDefault(callLuciZerotierSync(), {}).catch(function() {}).finally(function() {
				moonSyncBusy = false;
			});
		};

		var updateMoons = function() {
			return L.resolveDefault(callLuciZerotierListMoons(), {}).then(function(res) {
				var moonsEl = document.getElementById('zt_moons');
				if (!moonsEl) return;

				clearElement(moonsEl);

				if (!res || res.code !== 0) {
					moonsEl.appendChild(E('p', { style: 'color: gray' }, [
						_('Cannot read moons (is the ZeroTier service running?)')
					]));
					return;
				}

				var moons = parseMoons(res.moons);
				if (moons === null) {
					moonsEl.appendChild(E('p', { style: 'color: red' }, [_('Error reading moon list')]));
					return;
				}

				if (moons.length === 0) {
					moonsEl.appendChild(E('p', { style: 'color: gray' }, [_('No moons orbited')]));
					return;
				}

				var persisted = persistedMoonSet(res.persisted);
				moonsEl.appendChild(createMoonTable(moons, persisted));

				moons.forEach(function(moon) {
					if (persisted[moon.id]) {
						delete moonSyncTries[moon.id];
						return;
					}
					moonSyncTries[moon.id] = (moonSyncTries[moon.id] || 0) + 1;
					if (moonSyncTries[moon.id] <= 3) autoPersistMoons();
				});
			}).catch(function() {
				var moonsEl = document.getElementById('zt_moons');
				if (moonsEl) {
					clearElement(moonsEl);
					moonsEl.appendChild(E('p', { style: 'color: red' }, [_('Error loading moons')]));
				}
			});
		};

		var updateInfo = function() {
			return L.resolveDefault(callLuciZerotierIdentity(), {}).then(function(res) {
				var identityEl = document.getElementById('zt_identity');
				if (identityEl && res) {
					clearElement(identityEl);
					if (res.identity) {
						identityEl.appendChild(E('b', {}, [_('Address') + ':']));
						identityEl.appendChild(document.createTextNode(' '));
						var code = E('code', { style: 'font-size: 14px' }, [res.identity]);
						identityEl.appendChild(code);
					} else {
						identityEl.appendChild(E('b', {}, [_('Address') + ':']));
						identityEl.appendChild(document.createTextNode(' '));
						var span = E('span', { style: 'color: gray' }, ['-']);
						identityEl.appendChild(span);
					}
				}
			}).catch(function(err) {
				var identityEl = document.getElementById('zt_identity');
				if (identityEl) {
					clearElement(identityEl);
					identityEl.appendChild(E('b', {}, [_('Address') + ':']));
					identityEl.appendChild(document.createTextNode(' '));
					identityEl.appendChild(E('span', { style: 'color: gray' }, ['-']));
				}
			});
		};

		var createNetworkTable = function(networks) {
			var table = E('table', {
				class: 'cbi-section-table',
				style: 'width: 100%; border-collapse: collapse;'
			});

			var header = E('tr', { class: 'cbi-section-table-titles' });
			var headers = [_('Network ID'), _('Name'), _('Status'), _('Device'), _('IP Address')];
			for (var h = 0; h < headers.length; h++) {
				header.appendChild(E('th', { style: 'text-align: left; padding: 4px;' }, [headers[h]]));
			}
			table.appendChild(header);

			for (var i = 0; i < networks.length; i++) {
				var net = networks[i];
				var row = E('tr', { class: 'cbi-section-table-row' });

				var nwidTd = E('td', { style: 'text-align: left; padding: 4px;' });
				nwidTd.appendChild(E('code', {}, [net.nwid || '-']));
				row.appendChild(nwidTd);

				row.appendChild(E('td', { style: 'text-align: left; padding: 4px;' }, [net.name || '-']));

				var statusTd = E('td', { style: 'text-align: left; padding: 4px;' });
				statusTd.appendChild(E('span', { style: 'color: ' + getStatusColor(net.status) }, [net.status || '-']));
				row.appendChild(statusTd);

				row.appendChild(E('td', { style: 'text-align: left; padding: 4px; font-family: monospace;' }, [net.dev || '-']));
				row.appendChild(E('td', { style: 'text-align: left; padding: 4px; font-family: monospace; font-size: 12px;' }, [net.ips || '-']));

				table.appendChild(row);
			}

			return table;
		};

		var createPeerTable = function(peers) {
			var table = E('table', {
				class: 'cbi-section-table',
				style: 'width: 100%; border-collapse: collapse;'
			});

			var header = E('tr', { class: 'cbi-section-table-titles' });
			var headers = [_('Address'), _('Version'), _('Role'), _('Latency'), _('Link'), _('Path')];
			for (var h = 0; h < headers.length; h++) {
				header.appendChild(E('th', { style: 'text-align: left; padding: 4px;' }, [headers[h]]));
			}
			table.appendChild(header);

			for (var i = 0; i < peers.length; i++) {
				var peer = peers[i];
				var row = E('tr', { class: 'cbi-section-table-row' });

				var ztaddrTd = E('td', { style: 'text-align: left; padding: 4px;' });
				ztaddrTd.appendChild(E('code', {}, [peer.ztaddr || '-']));
				row.appendChild(ztaddrTd);

				row.appendChild(E('td', { style: 'text-align: left; padding: 4px;' }, [peer.version || '-']));

				var roleTd = E('td', { style: 'text-align: left; padding: 4px;' });
				roleTd.appendChild(E('span', { style: 'color: ' + getRoleColor(peer.role) }, [peer.role || '-']));
				row.appendChild(roleTd);

				row.appendChild(E('td', { style: 'text-align: left; padding: 4px;' }, [peer.latency || '-']));

				var linkTd = E('td', { style: 'text-align: left; padding: 4px;' });
				linkTd.appendChild(E('span', { style: 'color: ' + getLinkColor(peer.link) }, [peer.link || '-']));
				row.appendChild(linkTd);

				row.appendChild(E('td', { style: 'text-align: left; padding: 4px; font-family: monospace; font-size: 11px;' }, [peer.path || '-']));

				table.appendChild(row);
			}

			return table;
		};

		var updateNetworks = function() {
			return L.resolveDefault(callLuciZerotierNetworks(), {}).then(function(res) {
				var networksEl = document.getElementById('zt_networks');
				if (!networksEl) {
					return;
				}

				clearElement(networksEl);

				if (!res || !res.networks) {
					networksEl.appendChild(E('p', { style: 'color: gray' }, [_('No networks joined')]));
					return;
				}

				var networks = parseNetworks(res.networks);
				if (networks.length === 0) {
					networksEl.appendChild(E('p', { style: 'color: gray' }, [_('No networks joined')]));
					return;
				}

				networksEl.appendChild(createNetworkTable(networks));
			}).catch(function(err) {
				var networksEl = document.getElementById('zt_networks');
				if (networksEl) {
					clearElement(networksEl);
					networksEl.appendChild(E('p', { style: 'color: red' }, [_('Error loading networks')]));
				}
			});
		};

		var updatePeers = function() {
			return L.resolveDefault(callLuciZerotierPeers(), {}).then(function(res) {
				var peersEl = document.getElementById('zt_peers');
				if (!peersEl) {
					return;
				}

				clearElement(peersEl);

				if (!res || !res.peers) {
					peersEl.appendChild(E('p', { style: 'color: gray' }, [_('No peers')]));
					return;
				}

				var peers = parsePeers(res.peers);
				if (peers.length === 0) {
					peersEl.appendChild(E('p', { style: 'color: gray' }, [_('No peers')]));
					return;
				}

				peersEl.appendChild(createPeerTable(peers));
			}).catch(function(err) {
				var peersEl = document.getElementById('zt_peers');
				if (peersEl) {
					clearElement(peersEl);
					peersEl.appendChild(E('p', { style: 'color: red' }, [_('Error loading peers')]));
				}
			});
		};

		updateInfo();
		updateNetworks();
		updatePeers();
		updateMoons();

		poll.add(updateInfo, 10);
		poll.add(updateNetworks, 5);
		poll.add(updatePeers, 5);
		poll.add(updateMoons, 10);

		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
