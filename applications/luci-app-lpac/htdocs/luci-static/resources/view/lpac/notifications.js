// SPDX-License-Identifier: Apache-2.0
/* global lpac */

'use strict';
'require view';
'require ui';
'require lpac';

const isReadonlyView = !L.hasViewPermission() || null;

function operationLabel(operation) {
	switch (operation) {
	case 'install':
		return _('Install');
	case 'enable':
		return _('Enable');
	case 'disable':
		return _('Disable');
	case 'delete':
		return _('Delete');
	default:
		return _('Unknown');
	}
}

return view.extend({
	processing: false,
	processBlocked: {},
	processButtons: {},
	removeButtons: [],
	processAllButton: null,

	notificationSequence: function(notification) {
		const seq = notification?.seqNumber;

		return Number.isInteger(seq) && seq >= 0 && seq <= 4294967295
			? String(seq)
			: null;
	},

	updateProcessControls: function() {
		for (const seq in this.processButtons)
			this.processButtons[seq].disabled = !!(isReadonlyView || this.processing ||
				this.processBlocked[seq]);

		this.removeButtons.forEach(function(button) {
			button.disabled = !!(isReadonlyView || this.processing);
		}, this);

		if (this.processAllButton)
			this.processAllButton.disabled = !!(isReadonlyView || this.processing ||
				!this.processAllButton.notificationCount ||
				Object.keys(this.processBlocked).length);
	},

	load: function() {
		return L.resolveDefault(lpac.listNotifications(), null);
	},

	processNotifications: function(notifications, removeAfterSuccess) {
		if (this.processing || !notifications.length)
			return;

		this.processing = true;
		this.updateProcessControls();
		let completed = 0;
		const progress = E('span', {}, [
			_('Processing notification 1 of %d…').format(notifications.length)
		]);

		ui.showModal(notifications.length === 1
			? _('Processing notification')
			: _('Processing notifications'), [
			E('p', { 'class': 'spinning' }, [ progress ]),
			E('p', { 'class': 'cbi-value-description', 'role': 'note' }, [
				_('Do not close this page or retry a notification whose provider outcome is reported as unknown.')
			])
		]);

		let operation = Promise.resolve();

		notifications.forEach(function(notification, index) {
			operation = operation.then(function() {
				const seq = this.notificationSequence(notification);

				if (seq === null)
					throw new Error(lpac.errorMessage({ error: 'invalid_response' }));

				progress.textContent = _('Processing notification %d of %d…').format(
					index + 1, notifications.length);

				return lpac.processNotification(seq,
					removeAfterSuccess).then(function(result) {
					if (!result || !result.success) {
						const error = new Error(lpac.errorMessage(result));

						error.result = result;
						error.sequence = seq;
						throw error;
					}

					completed++;
					this.processBlocked[seq] = true;
				}.bind(this));
			}.bind(this));
		}, this);

		return operation.then(function() {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [
				completed === 1
					? _('The notification was processed successfully.')
					: _('%d notifications were processed successfully.').format(completed)
			]), 'info');

			if (removeAfterSuccess)
				window.location.reload();
		}).catch(function(error) {
			ui.hideModal();
			const partial = completed > 0
				? _('%d of %d notifications completed before processing stopped. ').format(
					completed, notifications.length)
				: '';
			const removeFailed =
				error.result?.reason === 'provider_processed_remove_failed';
			const unknown = error.result?.reason === 'provider_outcome_unknown' ||
				[ 'transport_error', 'timeout', 'execution_failed' ]
					.includes(error.result?.error);
			const noRetry = unknown || removeFailed;

			if (noRetry && error.sequence !== undefined)
				this.processBlocked[error.sequence] = true;

			ui.addNotification(null, E('p', {}, [
				partial, error.message, ' ', unknown
					? _('The provider outcome may be unknown; do not process this record again automatically. ')
					: removeFailed
						? _('The provider has processed this record; use Remove instead of processing it again. ')
						: '',
				_('Processing stopped. Refresh Notifications and review the remaining records before using Process all again.')
			]),
				noRetry ? 'warning' : 'error');
		}.bind(this)).finally(function() {
			this.processing = false;
			this.updateProcessControls();
		}.bind(this));
	},

	showProcessModal: function(notifications) {
		if (this.processing || !notifications.length)
			return;

		const remove = E('input', {
			'id': 'lpac-notification-remove-after-process',
			'type': 'checkbox',
			'checked': ''
		});
		const multiple = notifications.length > 1;

		ui.showModal(multiple ? _('Process notifications') : _('Process notification'), [
			E('p', {}, [ multiple
				? _('Send %d pending notifications to their providers in sequence? Processing stops at the first failure.').format(notifications.length)
				: _('Send notification sequence %s to its provider?').format(
					notifications[0].seqNumber)
			]),
			E('label', { 'class': 'cbi-value' }, [
				remove,
				' ',
				_('Remove each eUICC record after successful provider processing')
			]),
			E('p', { 'class': 'cbi-value-description', 'role': 'note' }, [
				_('If delivery has an unknown outcome, do not process that record again automatically. If delivery succeeded but removal failed, use the separate Remove action.')
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
						return this.processNotifications(notifications, remove.checked);
					})
				}, [ multiple ? _('Process all') : _('Process') ])
			])
		]);
	},

	showRemoveModal: function(notification) {
		const seq = this.notificationSequence(notification);

		if (seq === null)
			return;

		ui.showModal(_('Remove notification'), [
			E('p', {}, [
				_('Remove notification sequence %s from the eUICC?').format(seq)
			]),
			E('p', { 'class': 'alert-message warning' }, [
				_('Removing an unprocessed notification permanently discards its eUICC record without contacting the provider. It does not undo the profile operation and may leave the provider state out of sync. Only continue if the notification was processed elsewhere or is no longer needed.')
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
						ui.showModal(_('Removing notification'), [
							E('p', { 'class': 'spinning' }, [ _('Waiting for lpac…') ])
						]);

						return lpac.removeNotification(seq).then(function(result) {
							if (!result || !result.success)
								throw new Error(lpac.errorMessage(result));

							ui.hideModal();
							window.location.reload();
						}).catch(function(error) {
							ui.hideModal();
							ui.addNotification(null, E('p', {}, [ error.message ]), 'error');
						});
					})
				}, [ _('Remove') ])
			])
		]);
	},

	render: function(result) {
		const notifications = lpac.dataOr(result, []);
		const processable = notifications.filter(function(notification) {
			return this.notificationSequence(notification) !== null;
		}, this);
		this.processButtons = {};
		this.removeButtons = [];
		this.processAllButton = null;
		const table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th left' }, [ _('Sequence') ]),
				E('th', { 'class': 'th left' }, [ _('Operation') ]),
				E('th', { 'class': 'th left' }, [ _('ICCID') ]),
				E('th', { 'class': 'th left' }, [ _('Notification address') ]),
				E('th', { 'class': 'th right' }, [ _('Actions') ])
			])
		]);
		const rows = [];

		if (result && result.success) {
			notifications.forEach(function(notification) {
				const seq = this.notificationSequence(notification);
				const processButton = E('button', {
					'class': 'btn cbi-button-action',
					'disabled': isReadonlyView || this.processing || seq === null ||
						this.processBlocked[seq] || null,
					'click': ui.createHandlerFn(this, 'showProcessModal',
						[ notification ])
				}, [ _('Process') ]);
				const removeButton = E('button', {
					'class': 'btn cbi-button-negative',
					'disabled': isReadonlyView || this.processing || seq === null || null,
					'click': ui.createHandlerFn(this, 'showRemoveModal', notification)
				}, [ _('Remove') ]);

				if (seq !== null) {
					this.processButtons[seq] = processButton;
					this.removeButtons.push(removeButton);
				}

				rows.push([
					seq ?? '-',
					operationLabel(notification.profileManagementOperation),
					notification.iccid || '-',
					notification.notificationAddress || '-',
					E('div', { 'class': 'nowrap' }, [
						processButton,
						' ',
						removeButton
					])
				]);
			}, this);
		}

		cbi_update_table(table, rows, E('em', {}, [
			result && result.success
				? _('No pending notifications found.')
				: _('Notification data is unavailable.')
		]));

		const processAll = E('button', {
			'class': 'btn cbi-button cbi-button-positive',
			'disabled': isReadonlyView || this.processing ||
				!processable.length || Object.keys(this.processBlocked).length || null,
			'click': ui.createHandlerFn(this, 'showProcessModal', processable)
		}, [ _('Process all') ]);

		processAll.notificationCount = processable.length;
		this.processAllButton = processAll;

		return E([
			E('h2', {}, [ _('eUICC notifications') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Profile operations can create notifications that should normally be sent to the provider.')
			]),
			E('div', { 'class': 'alert-message warning', 'role': 'note' }, [
				_('Security warning: the bundled lpac does not verify the provider TLS certificate or hostname. Process uses that inherited transport. Remove only discards the local eUICC record and must not be used before provider processing unless you deliberately accept that loss.')
			]),
			(!result || !result.success)
				? E('div', { 'class': 'alert-message warning' }, [ lpac.errorMessage(result) ])
				: E([]),
			table,
			E('div', { 'class': 'cbi-page-actions' }, [
				processAll,
				' ',
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
