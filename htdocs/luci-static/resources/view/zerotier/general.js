'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require poll';
'require rpc';

var callLuciZerotierStatus = rpc.declare({
	object: 'luci-zerotier',
	method: 'status'
});

var callLuciZerotierIdentity = rpc.declare({
	object: 'luci-zerotier',
	method: 'get_identity'
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('zerotier')
		]);
	},

	render: function() {
		var m, s, o;

		m = new form.Map('zerotier', _('ZeroTier'),
			_('Zerotier is an open source, cross-platform and easy to use virtual LAN'));

		var originalSave = m.save.bind(m);
		m.save = function() {
			return originalSave().then(function(result) {
				var luciZerotierRpc = rpc.declare({
					object: 'luci-zerotier',
					method: 'reload'
				});

				L.resolveDefault(luciZerotierRpc(), {})
				.then(function(reloadResult) {
					if (reloadResult && reloadResult.code === 0) {
						var natValue = uci.get('zerotier', 'global', 'nat') || '0';
						var natMsg = natValue === '1' ? _('Auto NAT: Enabled') : _('Auto NAT: Disabled');
						ui.addNotification(null, E('p', natMsg), 'info');
					} else {
						var errorMsg = reloadResult && reloadResult.stderr ? reloadResult.stderr : _('Unknown error');
						ui.addNotification(null, E('p', _('Service reload failed: ') + errorMsg), 'warning');
					}
				})
				.catch(function(error) {
					ui.addNotification(null, E('p', _('Failed to reload service, please run manually: /etc/init.d/luci-zerotier reload')), 'warning');
				});

				return result;
			});
		};

		// Global settings section
		s = m.section(form.NamedSection, 'global', 'zerotier', _('Global Settings'));
		s.anonymous = true;
		s.addremove = false;

		s.tab('main', _('General options'));
		s.tab('more', _('Advanced options'));

		// General options
		o = s.taboption('main', form.Flag, 'enabled', _('Enable'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('main', form.Flag, 'nat', _('Auto NAT Clients'));
		o.description = _('Allow zerotier clients access your LAN network');
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('main', form.DummyValue, 'opennewwindow', '');
		o.render = function() {
			return E('div', { 'class': 'cbi-value-field' }, [
				E('input', {
					'type': 'button',
					'class': 'cbi-button cbi-button-apply',
					'value': 'Zerotier.com',
					'onclick': function() {
						window.open('https://my.zerotier.com/network', '_blank');
					}
				})
			]);
		};
		o.description = _('Create or manage your zerotier network, and auth clients who could access');

		// Advanced options
		o = s.taboption('more', form.Value, 'port', _('Port'));
		o.description = _('Port of zerotier service, default 9993');
		o.placeholder = '9993';
		o.datatype = 'port';

		o = s.taboption('more', form.TextValue, 'secret', _('Secret'));
		o.description = _('Secret of zerotier client');
		o.rows = 3;

		o = s.taboption('more', form.Value, 'local_conf', _('Local configuration'));
		o.description = _('Path to the local.conf');
		o.placeholder = '/etc/zerotier.conf';
		o.validate = function(section_id, value) {
			if (!value) return true;
			if (!value.match(/^(\/etc\/zerotier|\/var\/lib\/zerotier|\/tmp)(\/|$)/)) {
				return _('Path must be within /etc/zerotier, /var/lib/zerotier, or /tmp');
			}
			return true;
		};

		o = s.taboption('more', form.Value, 'config_path', _('Configuration folder'));
		o.description = _('Persistent configuration folder (for ZT controller mode)');
		o.placeholder = '/etc/zerotier';
		o.validate = function(section_id, value) {
			if (!value) return true;
			if (!value.match(/^(\/etc\/zerotier|\/var\/lib\/zerotier|\/tmp)(\/|$)/)) {
				return _('Path must be within /etc/zerotier, /var/lib/zerotier, or /tmp');
			}
			return true;
		};

		o = s.taboption('more', form.Flag, 'copy_config_path', _('Copy configuration folder'));
		o.description = _('Copy configuration folder to RAM to prevent writing to flash (for ZT controller mode)');

		// Networks section
		s = m.section(form.GridSection, 'network', _('Networks'));
		s.anonymous = false;
		s.addremove = true;
		s.sortable = true;

		o = s.option(form.Value, 'id', _('Network ID'));
		o.rmempty = false;

		o = s.option(form.Flag, 'allow_managed', _('Allow Managed'));
		o.default = '1';

		o = s.option(form.Flag, 'allow_global', _('Allow Global'));
		o.default = '0';

		o = s.option(form.Flag, 'allow_default', _('Allow Default Route'));
		o.default = '0';

		o = s.option(form.Flag, 'allow_dns', _('Allow DNS'));
		o.default = '0';

		return m.render().then(function(mapEl) {
			var infoDiv = E('div', {
				'id': 'zerotier_info',
				'style': 'margin: 0 16px; padding: 0; color: inherit; font-size: 16px; line-height: 1.6;'
			}, [
				E('span', {'id': 'zerotier_status'}, [
					E('em', {}, [_('Collecting data...')])
				]),
				E('br', {}),
				E('span', {'id': 'zerotier_identity'}, [
					E('em', {}, [_('Collecting identity...')])
				])
			]);

			var descDiv = mapEl.querySelector('.cbi-map-descr');
			if (descDiv && descDiv.parentNode) {
				descDiv.parentNode.insertBefore(infoDiv, descDiv.nextSibling);
			} else {
				mapEl.insertBefore(infoDiv, mapEl.firstChild);
			}

			var updateStatus = function() {
				return L.resolveDefault(callLuciZerotierStatus(), {}).then(function(res) {
					var statusEl = document.getElementById('zerotier_status');
					if (statusEl && res) {
						var runningClass = res.running ? 'green' : 'red';
						var runningText = res.running ? _('RUNNING') : _('NOT RUNNING');
						statusEl.textContent = '';
						statusEl.appendChild(E('b', {
							'style': 'color:' + runningClass
						}, ['ZeroTier ' + runningText]));
					}
				}).catch(function(err) {
					var statusEl = document.getElementById('zerotier_status');
					if (statusEl) {
						statusEl.textContent = '';
						statusEl.appendChild(E('b', {
							'style': 'color:red'
						}, ['ZeroTier ' + _('NOT RUNNING')]));
					}
				});
			};

			var updateIdentity = function() {
				return L.resolveDefault(callLuciZerotierIdentity(), {}).then(function(res) {
					var identityEl = document.getElementById('zerotier_identity');
					if (identityEl && res && res.identity) {
						identityEl.textContent = '';
						identityEl.appendChild(E('span', {}, [
							_('Address') + ': '
						]));
						identityEl.appendChild(E('b', {
							'style': 'font-family: monospace; color: inherit;'
						}, [res.identity]));
					}
				}).catch(function(err) {
					var identityEl = document.getElementById('zerotier_identity');
					if (identityEl) {
						identityEl.textContent = '';
						identityEl.appendChild(E('span', {}, [
							_('Address') + ': '
						]));
						identityEl.appendChild(E('b', {
							'style': 'color: gray;'
						}, ['-']));
					}
				});
			};

			poll.add(updateStatus, 3);
			poll.add(updateIdentity, 10);

			updateStatus();
			updateIdentity();

			return mapEl;
		});
	},

	handleSaveApply: function(ev, mode) {
		return this.handleSave(ev).then(function() {
			return ui.changes.apply(mode == '0');
		});
	},

	handleSave: function(ev) {
		var tasks = [];

		document.querySelectorAll('.cbi-map').forEach(function(map) {
			tasks.push(DOM.callClassMethod(map, 'save'));
		});

		return Promise.all(tasks);
	}
});
