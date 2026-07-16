// SPDX-License-Identifier: Apache-2.0
/* global lpac */

'use strict';
'require view';
'require ui';
'require lpac';

const isReadonlyView = !L.hasViewPermission() || null;

function profileLabel(profile) {
	return profile.profileNickname || profile.profileName ||
		profile.serviceProviderName || profile.iccid || profile.isdpAid || _('Unknown profile');
}

function profileStateLabel(state) {
	switch (state) {
	case 'enabled':
		return _('Enabled');
	case 'disabled':
		return _('Disabled');
	default:
		return _('Unknown');
	}
}

return view.extend({
	load: function() {
		return L.resolveDefault(lpac.listProfiles(), null);
	},

	runOperation: function(title, operation) {
		ui.showModal(title, [
			E('p', { 'class': 'spinning' }, [ _('Waiting for lpac…') ])
		]);

		return operation.then(function(result) {
			if (!result || !result.success)
				throw new Error(lpac.errorMessage(result));

			ui.hideModal();
			window.location.reload();
		}).catch(function(error) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [ error.message ]), 'error');
		});
	},

	showStateModal: function(profile, enable) {
		const id = profile.iccid || profile.isdpAid;
		const label = profileLabel(profile);
		const refresh = E('input', {
			'type': 'checkbox',
			'checked': true
		});

		ui.showModal(enable ? _('Enable profile') : _('Disable profile'), [
			E('p', {}, [
				enable
					? _('Enable profile “%s”?').format(label)
					: _('Disable profile “%s”?').format(label)
			]),
			E('label', { 'class': 'cbi-value' }, [
				refresh,
				' ',
				_('Request an eUICC refresh')
			]),
			E('p', { 'class': 'alert-message warning' }, [
				_('Changing the active profile can interrupt mobile connectivity. Some modems require a separate SIM power cycle or reconnect afterwards.')
			]),
			E('p', { 'class': 'alert-message warning' }, [
				_('lpac may create a provider notification after this change. Secure network notification processing is not available in this version, so the notification may remain pending on the eUICC.')
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': ui.hideModal
				}, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(this, function() {
						const operation = enable
							? lpac.enableProfile(id, refresh.checked)
							: lpac.disableProfile(id, refresh.checked);

						return this.runOperation(
							enable ? _('Enabling profile') : _('Disabling profile'),
							operation
						);
					})
				}, [ enable ? _('Enable') : _('Disable') ])
			])
		]);
	},

	showNicknameModal: function(profile) {
		const iccid = profile.iccid;
		const input = E('input', {
			'id': 'lpac-profile-nickname',
			'class': 'cbi-input-text',
			'type': 'text',
			'maxlength': 64,
			'value': profile.profileNickname || '',
			'placeholder': _('Leave empty to clear the nickname')
		});

		ui.showModal(_('Set profile nickname'), [
			E('div', { 'class': 'cbi-value' }, [
				E('label', {
					'class': 'cbi-value-title',
					'for': 'lpac-profile-nickname'
				}, [ _('Nickname') ]),
				E('div', { 'class': 'cbi-value-field' }, [ input ])
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': ui.hideModal
				}, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-positive important',
					'click': ui.createHandlerFn(this, function() {
						return this.runOperation(
							_('Updating nickname'),
							lpac.nicknameProfile(iccid, input.value)
						);
					})
				}, [ _('Save') ])
			])
		]);

		input.focus();
	},

	showDeleteModal: function(profile) {
		const id = profile.iccid || profile.isdpAid;

		ui.showModal(_('Delete profile'), [
			E('p', {}, [
				_('Permanently delete profile “%s”? This action cannot be undone.').format(profileLabel(profile))
			]),
			E('p', { 'class': 'alert-message warning' }, [
				_('lpac creates a provider notification after deletion. Secure network notification processing is not available in this initial version, so the notification will remain pending on the eUICC.')
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': ui.hideModal
				}, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-negative important',
					'click': ui.createHandlerFn(this, function() {
						return this.runOperation(_('Deleting profile'), lpac.deleteProfile(id));
					})
				}, [ _('Delete') ])
			])
		]);
	},

	render: function(result) {
		const profiles = lpac.dataOr(result, []);
		const table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th left' }, [ _('Profile') ]),
				E('th', { 'class': 'th left' }, [ _('Provider') ]),
				E('th', { 'class': 'th left' }, [ _('ICCID') ]),
				E('th', { 'class': 'th left' }, [ _('State') ]),
				E('th', { 'class': 'th right' }, [ _('Actions') ])
			])
		]);
		const rows = [];

		if (result && result.success) {
			profiles.forEach(function(profile) {
				const state = String(profile.profileState || '').toLowerCase();
				const enabled = state === 'enabled';
				const disabled = state === 'disabled';
				const id = profile.iccid || profile.isdpAid;
				const actions = E('div', { 'class': 'nowrap' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'disabled': isReadonlyView || !id || (!enabled && !disabled),
						'title': (!enabled && !disabled)
							? _('The profile state does not allow this action') : '',
						'click': ui.createHandlerFn(this, 'showStateModal', profile, !enabled)
					}, [ enabled ? _('Disable') : disabled ? _('Enable') : _('Unavailable') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-edit',
						'disabled': isReadonlyView || !profile.iccid,
						'title': !profile.iccid
							? _('An ICCID is required to rename this profile') : '',
						'click': ui.createHandlerFn(this, 'showNicknameModal', profile)
					}, [ _('Rename') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-negative',
						'disabled': isReadonlyView || !disabled || !id,
						'title': !disabled
							? _('Only a disabled profile can be deleted') : '',
						'click': ui.createHandlerFn(this, 'showDeleteModal', profile)
					}, [ _('Delete') ])
				]);

				rows.push([
					profileLabel(profile),
					profile.serviceProviderName || '-',
					profile.iccid || '-',
					profileStateLabel(state),
					actions
				]);
			}, this);
		}

		cbi_update_table(table, rows, E('em', {}, [
			result && result.success
				? _('No eSIM profiles found.')
				: _('Profile data is unavailable.')
		]));

		return E([
			E('h2', {}, [ _('eSIM profiles') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Profiles are read directly from the eUICC using the configured lpac APDU backend.')
			]),
			(!result || !result.success)
				? E('div', { 'class': 'alert-message warning' }, [ lpac.errorMessage(result) ])
				: E([]),
			table,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, function() {
						window.location.reload();
					})
				}, [ _('Refresh') ])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
