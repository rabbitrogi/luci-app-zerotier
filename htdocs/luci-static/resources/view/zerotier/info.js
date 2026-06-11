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
								btn.value = _('Pinging...');
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
											statusEl.style.color = 'green';
											statusEl.textContent = _('Online') + ': ' + okCount;

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
										} else {
											statusEl.textContent = res && res.stderr ? res.stderr : _('No IPs to ping');
										}
									}
									if (btn) {
										btn.disabled = false;
										btn.value = _('Ping All');
									}
								}).catch(function(err) {
									if (statusEl) {
										statusEl.textContent = _('Error');
									}
									if (btn) {
										btn.disabled = false;
										btn.value = _('Ping All');
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
				])
			])
		]);

		var parseNetworks = function(rawOutput) {
			if (!rawOutput || typeof rawOutput !== 'string') {
				return [];
			}

			var lines = rawOutput.trim().split('\n');
			var networks = [];

			for (var i = 1; i < lines.length; i++) {
				var line = lines[i].trim();
				if (!line) {
					continue;
				}

				var parts = line.split(/\s+/);
				if (parts.length >= 9) {
					networks.push({
						nwid: parts[2] || '',
						name: parts[3] || '',
						mac: parts[4] || '',
						status: parts[5] || '',
						type: parts[6] || '',
						dev: parts[7] || '',
						ips: parts.slice(8).join(' ')
					});
				}
			}
			return networks;
		};

		var parsePeers = function(rawOutput) {
			if (!rawOutput || typeof rawOutput !== 'string') {
				return [];
			}

			var lines = rawOutput.trim().split('\n');
			var peers = [];

			for (var i = 1; i < lines.length; i++) {
				var line = lines[i].trim();

				if (!line) {
					continue;
				}

				if (line.indexOf('NOTE:') === 0 || line.indexOf('<') >= 0) {
					continue;
				}

				if (!/^[0-9a-f]{10}\s/.test(line)) {
					continue;
				}

				var parts = line.split(/\s+/);
				if (parts.length >= 6) {
					peers.push({
						ztaddr: parts[0] || '',
						version: parts[1] || '-',
						role: parts[2] || '-',
						latency: parts[3] || '-',
						link: parts[4] || '-',
						lastTX: parts[5] || '-',
						lastRX: parts[6] || '-',
						path: parts.slice(7).join(' ') || '-'
					});
				}
			}
			return peers;
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
			var headers = [_('Address'), _('Version'), _('Role'), _('Latency'), _('Link'), _('Last TX'), _('Last RX'), _('Path')];
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

				row.appendChild(E('td', { style: 'text-align: left; padding: 4px;' }, [peer.lastTX || '-']));
				row.appendChild(E('td', { style: 'text-align: left; padding: 4px;' }, [peer.lastRX || '-']));
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

		poll.add(updateInfo, 10);
		poll.add(updateNetworks, 5);
		poll.add(updatePeers, 5);

		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
