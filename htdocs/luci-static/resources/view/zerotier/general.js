'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require poll';
'require rpc';

var callZerotierStatus = rpc.declare({
	object: 'zerotier',
	method: 'status'
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

		// Simple and direct reload after save - no complex verification
		var originalSave = m.save.bind(m);
		m.save = function() {
			console.log('ZeroTier config save started...');

			return originalSave().then(function(result) {
				console.log('ZeroTier config saved, scheduling service reload in 5 seconds...');

				// Use custom luci-zerotier RPC for automatic reload
				console.log('Scheduling service reload in 5 seconds...');

				setTimeout(function() {
					console.log('=== 5 SECONDS ELAPSED - EXECUTING AUTOMATIC RELOAD ===');

					// Use our custom luci-zerotier RPC
					var luciZerotierRpc = rpc.declare({
						object: 'luci-zerotier',
						method: 'reload'
					});

					console.log('Executing automatic reload via luci-zerotier RPC...');
					L.resolveDefault(luciZerotierRpc(), {})
					.then(function(reloadResult) {
						console.log('Reload result:', reloadResult);

						if (reloadResult && reloadResult.code === 0) {
							console.log('Reload successful, output:', reloadResult.stdout);

							// Show the reload output to user
							if (reloadResult.stdout && reloadResult.stdout.trim()) {
								ui.addNotification(null, E('div', [
									E('p', { style: 'font-weight: bold; color: green;' }, _('ZeroTier Service Reloaded Successfully')),
									E('pre', {
										style: 'background: #f0f8f0; padding: 10px; border-radius: 4px; font-size: 12px; white-space: pre-wrap; border-left: 4px solid #4CAF50;'
									}, reloadResult.stdout)
								]), 'info');
							} else {
								ui.addNotification(null, E('p', _('ZeroTier service reloaded successfully.')), 'info');
							}

							// Check final status
							setTimeout(function() {
								L.resolveDefault(callZerotierStatus(), {}).then(function(status) {
									console.log('Final service status:', status);
									var statusMsg = 'Service status: ' + (status && status.running ? 'Running' : 'Stopped');
									var natValue = uci.get('zerotier', 'global', 'nat') || '0';
									var natMsg = 'NAT setting: ' + (natValue === '1' ? 'Enabled' : 'Disabled');

									ui.addNotification(null, E('p', statusMsg + ' | ' + natMsg), 'info');
								});
							}, 2000);

						} else {
							console.warn('Reload failed or returned error:', reloadResult);
							var errorMsg = reloadResult && reloadResult.stderr ? reloadResult.stderr : 'Unknown error';
							ui.addNotification(null, E('p', _('Service reload failed: ') + errorMsg), 'warning');
						}
					})
					.catch(function(error) {
						console.error('RPC reload failed:', error);
						ui.addNotification(null, E('p', _('Failed to reload service automatically. Please run manually: /etc/init.d/luci-zerotier reload')), 'warning');
					});
				}, 5000); // Wait 5 seconds after save

				// Return immediately after scheduling, don't wait for reload
				ui.addNotification(null, E('p', _('ZeroTier configuration saved. Service will reload in 5 seconds.')), 'info');
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
		o.datatype = 'and(port,min(1025))';

		o = s.taboption('more', form.TextValue, 'secret', _('Secret'));
		o.description = _('Secret of zerotier client');
		o.rows = 3;

		o = s.taboption('more', form.Value, 'local_conf', _('Local configuration'));
		o.description = _('Path to the local.conf');
		o.placeholder = '/etc/zerotier.conf';
		o.datatype = 'file';

		o = s.taboption('more', form.Value, 'config_path', _('Configuration folder'));
		o.description = _('Persistent configuration folder (for ZT controller mode)');
		o.placeholder = '/etc/zerotier';

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
			// Add status display right after the main title
			var statusDiv = E('div', {
				'id': 'zerotier_status',
				'style': 'margin: 16px 16px; padding: 8px 0; color: inherit; font-size: 16px;'
			}, [
				E('em', {}, _('Collecting data...'))
			]);

			// Find the main description and insert status after it
			var descDiv = mapEl.querySelector('.cbi-map-descr');
			if (descDiv && descDiv.parentNode) {
				descDiv.parentNode.insertBefore(statusDiv, descDiv.nextSibling);
			} else {
				// Fallback: insert at the beginning
				mapEl.insertBefore(statusDiv, mapEl.firstChild);
			}

			// Add status polling
			poll.add(function() {
				return L.resolveDefault(callZerotierStatus(), {}).then(function(res) {
					console.log('ZeroTier status response:', res);
					var statusEl = document.getElementById('zerotier_status');
					if (statusEl) {
						if (res && (res.running === true || res.running === 1)) {
							statusEl.innerHTML = '<em><b style="color:green">ZeroTier ' + _('RUNNING') + '</b></em>';
						} else {
							statusEl.innerHTML = '<em><b style="color:red">ZeroTier ' + _('NOT RUNNING') + '</b></em>';
						}
					}
				}).catch(function(err) {
					console.error('ZeroTier status check failed:', err);
					var statusEl = document.getElementById('zerotier_status');
					if (statusEl) {
						statusEl.innerHTML = '<em><b style="color:red">ZeroTier ' + _('NOT RUNNING') + '</b></em>';
					}
				});
			}, 3);

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
