'use strict';
'require view';
'require fs';
'require ui';
'require poll';
'require rpc';

var callGetInterfaceInfo = rpc.declare({
	object: 'zerotier',
	method: 'interfaces'
});

return view.extend({
	load: function() {
		return Promise.resolve();
	},

	render: function() {
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [_('ZeroTier'), ' - ', _('Interface Info')]),
			E('div', { 'class': 'cbi-section' }, [
				E('textarea', {
					'id': 'zerotier_interface_info',
					'readonly': 'readonly',
					'rows': 20,
					'style': 'width: 98%; font-family: "Courier New", Consolas, monospace; font-size: 13px; border: 1px groove gray; border-radius: 5px; background-color: transparent; margin:12px; padding: 10px; white-space: pre; overflow-x: auto; color: inherit; resize: both; min-height: 400px;'
				}, _('Loading interface information...'))
			])
		]);

		// Function to format interface information
		var formatInterfaceInfo = function(rawInfo) {
			if (!rawInfo || !rawInfo.trim()) {
				return _('No ZeroTier interfaces found');
			}

			// Clean up and format the interface information for better display
			return rawInfo.trim();
		};

		// Function to update interface info
		var updateInterfaceInfo = function() {
			return L.resolveDefault(callGetInterfaceInfo(), {}).then(function(res) {
				console.log('Interface info response:', res);
				var textarea = document.getElementById('zerotier_interface_info');
				if (textarea) {
					if (res && res.interfaces && res.interfaces.trim()) {
						textarea.value = formatInterfaceInfo(res.interfaces);
					} else {
						textarea.value = _('No ZeroTier interfaces found');
					}
				}
			}).catch(function(err) {
				console.error('Interface info retrieval failed:', err);
				var textarea = document.getElementById('zerotier_interface_info');
				if (textarea) {
					textarea.value = _('Error retrieving interface information: ') + (err.message || err);
				}
			});
		};

		// Initial load
		updateInterfaceInfo();

		// Set up polling to refresh interface info every 5 seconds
		poll.add(updateInterfaceInfo, 5);

		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
