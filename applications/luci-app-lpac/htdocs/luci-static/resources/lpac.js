// SPDX-License-Identifier: Apache-2.0

'use strict';
'require rpc';
'require baseclass';

const callGetVersion = rpc.declare({
	object: 'luci.lpac',
	method: 'get_version',
	expect: {}
});

const callGetDrivers = rpc.declare({
	object: 'luci.lpac',
	method: 'get_drivers',
	expect: {}
});

const callGetInfo = rpc.declare({
	object: 'luci.lpac',
	method: 'get_info',
	expect: {}
});

const callSetDefaultSmdp = rpc.declare({
	object: 'luci.lpac',
	method: 'set_default_smdp',
	params: [ 'address' ],
	expect: {}
});

const callListProfiles = rpc.declare({
	object: 'luci.lpac',
	method: 'list_profiles',
	expect: {}
});

const callListNotifications = rpc.declare({
	object: 'luci.lpac',
	method: 'list_notifications',
	expect: {}
});

const callDownloadProfile = rpc.declare({
	object: 'luci.lpac',
	method: 'download_profile',
	params: [
		'mode', 'activation_code', 'smdp', 'matching_id', 'imei',
		'confirmation_code'
	],
	expect: {}
});

const callGetDownloadStatus = rpc.declare({
	object: 'luci.lpac',
	method: 'get_download_status',
	params: [ 'job_id', 'decision_token' ],
	expect: {}
});

const callRespondDownloadPreview = rpc.declare({
	object: 'luci.lpac',
	method: 'respond_download_preview',
	params: [ 'job_id', 'decision_token', 'accept' ],
	expect: {}
});

const callEnableProfile = rpc.declare({
	object: 'luci.lpac',
	method: 'enable_profile',
	params: [ 'iccid', 'refresh' ],
	expect: {}
});

const callDisableProfile = rpc.declare({
	object: 'luci.lpac',
	method: 'disable_profile',
	params: [ 'iccid', 'refresh' ],
	expect: {}
});

const callNicknameProfile = rpc.declare({
	object: 'luci.lpac',
	method: 'nickname_profile',
	params: [ 'iccid', 'nickname' ],
	expect: {}
});

const callDeleteProfile = rpc.declare({
	object: 'luci.lpac',
	method: 'delete_profile',
	params: [ 'iccid' ],
	expect: {}
});

const callRemoveNotification = rpc.declare({
	object: 'luci.lpac',
	method: 'remove_notification',
	params: [ 'seq' ],
	expect: {}
});

const callProcessNotification = rpc.declare({
	object: 'luci.lpac',
	method: 'process_notification',
	params: [ 'seq', 'remove_after_success' ],
	expect: {}
});

const callGetConfig = rpc.declare({
	object: 'luci.lpac',
	method: 'get_config',
	expect: {}
});

const callSetConfig = rpc.declare({
	object: 'luci.lpac',
	method: 'set_config',
	params: [ 'config' ],
	expect: {}
});

function safeCall(call) {
	return function() {
		return call.apply(null, arguments).catch(function() {
			return {
				success: false,
				error: 'transport_error'
			};
		});
	};
}

function validIpv4Host(value) {
	const octets = value.split('.');

	return octets.length === 4 && octets.every(function(octet) {
		return /^(0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255;
	});
}

function validIpv6Host(value) {
	if (!value.includes(':') || value.indexOf('::') !== value.lastIndexOf('::'))
		return false;

	const compressed = value.includes('::');
	const halves = compressed ? value.split('::') : [ value ];
	let groups = [];

	halves.forEach(function(half) {
		if (half.length)
			groups = groups.concat(half.split(':'));
	});

	let groupCount = groups.length;
	const ipv4 = groups.length && groups[groups.length - 1].includes('.');

	if (ipv4) {
		if (!validIpv4Host(groups.pop()))
			return false;

		groupCount++;
	}

	if (!groups.every(function(group) {
		return /^[0-9A-Fa-f]{1,4}$/.test(group);
	}))
		return false;

	return compressed ? groupCount < 8 : groupCount === 8;
}

function validSmdpAddress(value) {
	if (typeof value !== 'string' || !value.length || value.length > 255 ||
	    /[\s\u0000-\u001F\u007F]/.test(value))
		return false;

	const ipv6 = value.match(/^\[([0-9A-Fa-f:.]+)\](?::([0-9]{1,5}))?$/);

	if (ipv6) {
		if (!validIpv6Host(ipv6[1]))
			return false;

		if (ipv6[2]) {
			const port = Number(ipv6[2]);

			if (port < 1 || port > 65535)
				return false;
		}

		return true;
	}

	const parsed = value.match(/^([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/);

	if (!parsed || parsed[1].length > 253 || parsed[1].startsWith('.') ||
	    parsed[1].endsWith('.'))
		return false;

	if (parsed[2]) {
		const port = Number(parsed[2]);

		if (port < 1 || port > 65535)
			return false;
	}

	const host = parsed[1];

	if (/^[0-9.]+$/.test(host))
		return validIpv4Host(host);

	return host.split('.').every(function(label) {
		return label.length >= 1 && label.length <= 63 &&
			/^[A-Za-z0-9-]+$/.test(label) &&
			!label.startsWith('-') && !label.endsWith('-');
	});
}

return baseclass.extend({
	getVersion: safeCall(callGetVersion),
	getDrivers: safeCall(callGetDrivers),
	getInfo: safeCall(callGetInfo),
	setDefaultSmdp: safeCall(callSetDefaultSmdp),
	listProfiles: safeCall(callListProfiles),
	listNotifications: safeCall(callListNotifications),
	downloadProfile: safeCall(callDownloadProfile),
	getDownloadStatus: safeCall(callGetDownloadStatus),
	respondDownloadPreview: safeCall(callRespondDownloadPreview),
	enableProfile: safeCall(callEnableProfile),
	disableProfile: safeCall(callDisableProfile),
	nicknameProfile: safeCall(callNicknameProfile),
	deleteProfile: safeCall(callDeleteProfile),
	processNotification: safeCall(callProcessNotification),
	removeNotification: safeCall(callRemoveNotification),
	getConfig: safeCall(callGetConfig),
	setConfig: safeCall(callSetConfig),
	validSmdpAddress,

	errorMessage: function(result) {
		if (!result)
			return _('No response from the lpac service.');

		if (result.reason === 'outcome_unknown')
			return _('The profile download outcome is unknown. Refresh Profiles and Notifications before retrying so that the same activation code is not submitted twice.');

		if (result.reason === 'preview_timeout')
			return _('The profile preview expired without a decision and was cancelled before installation.');

		if (result.reason === 'preview_protocol_error')
			return _('lpac could not complete the protected profile-preview exchange. The profile was not approved for installation.');

		switch (result.error) {
		case 'busy':
			return _('Another lpac operation is already running.');
		case 'invalid_argument':
			return _('The request contains an invalid argument.');
		case 'invalid_config':
			return _('The lpac configuration is invalid.');
		case 'job_not_found':
			return _('The profile download job is no longer available. Refresh Profiles and Notifications before retrying.');
		case 'not_authorized':
			return _('This browser tab is not authorized to approve the profile preview.');
		case 'not_ready':
			return _('The profile preview is not ready for a decision.');
		case 'invalid_state':
			return _('The profile preview decision is no longer available.');
		case 'not_installed':
			return _('The lpac executable is not installed.');
		case 'timeout':
			return _('The lpac operation timed out.');
		case 'output_too_large':
			return _('The lpac output exceeded the RPC response limit.');
		case 'execution_failed':
			return _('The lpac process could not be executed.');
		case 'lock_failed':
			return _('The lpac operation lock could not be created.');
		case 'config_write_failed':
			return _('The lpac configuration could not be saved.');
		case 'transport_error':
			return _('The lpac RPC request failed or timed out.');
		case 'lpac_error':
			switch (result.reason) {
			case 'download_failed':
				return _('lpac could not download the profile. Verify the activation details, network connection, and provider service.');
			case 'notification_retrieve_failed':
				return _('lpac could not retrieve this notification from the eUICC. Refresh the notification list before retrying.');
			case 'provider_outcome_unknown':
				return _('The provider notification outcome is unknown. Do not send it again automatically; refresh the list and review it first.');
			case 'provider_processed_remove_failed':
				return _('The provider accepted the notification, but lpac could not remove its local eUICC record. Use Remove instead of processing it again.');
			case 'profile_not_found':
				return _('lpac could not find that profile identifier. Try the other identifier if available.');
			case 'profile_not_disabled':
				return _('The profile is not in the disabled state required for enabling.');
			case 'profile_not_enabled':
				return _('The profile is not in the enabled state required for disabling.');
			case 'policy_denied':
				return _('The eUICC profile policy rejected this operation.');
			case 'wrong_reenable':
				return _('The eUICC rejected re-enabling this profile.');
			case 'profile_internal_error':
				return _('lpac reported an internal profile error. Try the other identifier and refresh setting.');
			}

			return Number.isInteger(result.code) && result.code >= 0
				? _('lpac rejected the operation (code %d).').format(result.code)
				: _('lpac rejected the operation.');
		case 'invalid_response':
			return _('lpac returned an invalid or unexpected response.');
		case 'rpc_error':
			return result.message || _('The lpac RPC request failed.');
		default:
			return result.message || result.error || _('The lpac operation failed.');
		}
	},

	dataOr: function(result, fallback) {
		return result && result.success ? result.data : fallback;
	}
});
