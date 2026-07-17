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

var callLuciZerotierReload = rpc.declare({
	object: 'luci-zerotier',
	method: 'reload'
});

// Mask all but the first 4 and last 4 chars of a secret for display.
// Used for the `secret` field so the value reaching the browser cannot
// be directly exfiltrated, while still giving the user a visual cue that
// a secret is configured and roughly what it looks like.
var maskSecret = function(s) {
	if (!s) return '';
	if (s.length <= 8) return '••••••••';
	return s.substring(0, 4) + '••••••••' + s.substring(s.length - 4);
};

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
		o.description = _('Secret of zerotier client. Displayed masked for security; clear the field and paste a new identity.secret to replace it.');
		o.rows = 3;
		o.cfgvalue = function(section_id) {
			var val = uci.get('zerotier', section_id, 'secret');
			return val ? maskSecret(val) : '';
		};
		o.write = function(section_id, formvalue) {
			var current = uci.get('zerotier', section_id, 'secret');
			if (!formvalue || (current && formvalue === maskSecret(current))) {
				return;
			}
			uci.set('zerotier', section_id, 'secret', formvalue);
		};

		o = s.taboption('more', form.Value, 'local_conf_path', _('Local configuration'));
		o.description = _('Path to the local.conf');
		o.placeholder = '/etc/zerotier.conf';
		o.validate = function(section_id, value) {
			if (!value) return true;
			// /etc/zerotier.conf is the upstream zerotier package's conventional
			// single-file location (see the commented option in its stock config)
			if (!value.match(/^(\/etc\/zerotier\.conf|\/etc\/zerotier|\/var\/lib\/zerotier|\/tmp)(\/|$)/)) {
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
		o.validate = function(section_id, value) {
			if (value && !/^[0-9a-fA-F]{16}$/.test(value)) {
				return _('Network ID must be 16 hex characters (0-9, a-f)');
			}
			return true;
		};

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
		// Reload the service only AFTER the apply has committed the staged
		// configuration: Map.save() alone merely writes to the ubus session
		// delta, so reloading earlier would read the previous config (and the
		// notification would describe a state that is not in effect yet).
		return this.handleSave(ev).then(function() {
			return ui.changes.apply(mode == '0');
		}).then(function() {
			return L.resolveDefault(callLuciZerotierReload(), {});
		}).then(function(reloadResult) {
			if (reloadResult && reloadResult.code === 0) {
				var natValue = uci.get('zerotier', 'global', 'nat') || '0';
				var natMsg = natValue === '1' ? _('Auto NAT: Enabled') : _('Auto NAT: Disabled');
				ui.addNotification(null, E('p', natMsg), 'info');
			} else {
				var errorMsg = reloadResult && reloadResult.stderr ? reloadResult.stderr : _('Unknown error');
				ui.addNotification(null, E('p', _('Service reload failed: ') + errorMsg), 'warning');
			}
		}).catch(function(error) {
			ui.addNotification(null, E('p', _('Failed to reload service, please run manually: /etc/init.d/luci-zerotier reload')), 'warning');
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
