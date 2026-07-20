// SPDX-License-Identifier: Apache-2.0

'use strict';

function default_config() {
	return {
		global: {
			apdu_backend: 'mbim',
			http_backend: 'curl',
			apdu_debug: '0',
			http_debug: '0',
			custom_isd_r_aid: 'A0000005591010FFFFFFFF8900000100'
		},
		at: {
			device: '/dev/ttyUSB2',
			debug: '0'
		},
		uqmi: {
			device: '/dev/cdc-wdm0',
			debug: '0'
		},
		mbim: {
			device: '/dev/cdc-wdm0',
			proxy: '1',
			skip_slot_mapping: '1'
		}
	};
}

function reset() {
	global.TEST_UCI = default_config();
	global.TEST_UCI_LOAD_FAIL = false;
	global.TEST_COMMIT_OK = true;
	global.TEST_LOCK_EXISTS = false;
	global.TEST_LOCK_TYPE = 'file';
	global.TEST_LOCK_UID = 0;
	global.TEST_LOCK_NLINK = 1;
	global.TEST_LOCK_MODE = 0o600;
	global.TEST_LOCK_OPEN_FAIL = false;
	global.TEST_LOCK_CHMOD_FAIL = false;
	global.TEST_LOCK_BUSY = false;
	global.TEST_LOCK_CLOSED = false;
	global.TEST_LOCK_CLOSE_COUNT = 0;
	global.TEST_DEFER_THROW = false;
	global.TEST_DEFER_NULL = false;
	global.TEST_EXEC_STATUS = 0;
	global.TEST_EXEC_REPLY = null;
	global.TEST_LAST_CALL = null;
	global.TEST_LPAC_ACCESS = true;
	global.TEST_ACCESS = null;
	global.TEST_TASK_THROW = false;
	global.TEST_TASK_NULL = false;
	global.TEST_TASK_FINISHED_THROW = false;
	global.TEST_TASKS = [];
	global.TEST_LAST_TASK = null;
	global.TEST_SYSTEM_EXIT = 0;
	global.TEST_SYSTEM_THROW = false;
	global.TEST_SYSTEM_CALL = null;
	global.TEST_DEVNULL_OPEN_FAIL = false;
	global.TEST_DEVNULL_OPEN = null;
	global.TEST_DEVNULL_FD = 9;
	global.TEST_DEVNULL_FILENO_FAIL = false;
	global.TEST_DEVNULL_CLOSE_FAIL = false;
	global.TEST_DEVNULL_CLOSE_ATTEMPTS = 0;
	global.TEST_DEVNULL_CLOSED = false;
	global.TEST_DUP2_FAIL_TARGET = null;
	global.TEST_REDIRECT_EVENTS = [];
	global.system = function(argv, timeout) {
		push(global.TEST_REDIRECT_EVENTS, 'system');
		global.TEST_SYSTEM_CALL = { argv, timeout };

		if (global.TEST_SYSTEM_THROW)
			die('system failed');

		return global.TEST_SYSTEM_EXIT;
	};
}

let checks = 0;

function check(condition, message) {
	checks++;

	if (!condition)
		die(`not ok ${checks} - ${message}\n`);

	printf(`ok ${checks} - ${message}\n`);
}

function same(actual, expected, message) {
	check(sprintf('%J', actual) == sprintf('%J', expected), message);
}

reset();

const plugin = loadfile('./root/usr/share/rpcd/ucode/luci.lpac', {
	module_search_path: [ '../../../../../tests/lib/*.uc' ]
})();
const methods = plugin['luci.lpac'];

function invoke(name, args) {
	let replied = false;
	let response = null;
	const request = {
		args: args || {},
		reply: function(result) {
			replied = true;
			response = result;
		}
	};
	const returned = methods[name].call(request);

	return replied ? response : returned;
}

function activation_download(code, confirmation, imei) {
	return invoke('download_profile', {
		mode: 'activation',
		activation_code: code,
		smdp: '',
		matching_id: '',
		imei: imei || '',
		confirmation_code: confirmation || ''
	});
}

function manual_download(smdp, matching_id, confirmation, imei) {
	return invoke('download_profile', {
		mode: 'manual',
		activation_code: '',
		smdp: smdp || '',
		matching_id: matching_id || '',
		imei: imei || '',
		confirmation_code: confirmation || ''
	});
}

function complete_download(exit_code) {
	const state = global.TEST_LAST_TASK;

	global.TEST_SYSTEM_EXIT = exit_code;

	const output = state.worker();

	state.finished = true;
	state.output(output);

	return output;
}

function check_redirection_failure(configure, expected_events, message) {
	reset();
	configure();

	const started = manual_download('smdp.example.com', 'MATCH', 'secret', '');

	check(started.success, `${message}: job starts`);
	complete_download(0);

	const status = invoke('get_download_status', {
		job_id: started.data.job_id
	});

	check(!status.success && status.error == 'execution_failed' &&
		global.TEST_SYSTEM_CALL === null && global.TEST_LOCK_CLOSE_COUNT == 2 &&
		index(sprintf('%J', status), 'secret') < 0,
		`${message}: lpac is not run and failure is redacted`);
	same(global.TEST_REDIRECT_EVENTS, expected_events,
		`${message}: redirection steps are ordered`);
}

function make_text(character, count) {
	let value = '';

	for (let i = 0; i < count; i++)
		value += character;

	return value;
}

function terminal(data, code) {
	if (type(code) != 'int')
		code = 0;

	return sprintf('%J\n', {
		type: 'lpa',
		payload: {
			code,
			message: code == 0 ? 'success' : 'failure',
			data
		}
	});
}

global.TEST_EXEC_REPLY = { code: 0, stdout: terminal('v2.3.0') };
let result = invoke('get_version');
check(result.success && result.data == 'v2.3.0', 'version response is normalized');
check(global.TEST_LAST_CALL.request.command == '/usr/bin/lpac',
	'packaged lpac entrypoint is executed directly for non-eUICC commands');
same(global.TEST_LAST_CALL.request.params, [ 'version' ], 'version argv is fixed');

reset();
result = invoke('get_config');
same(result.data, default_config(),
	'configuration reads expose the normalized MBIM slot-mapping preference');

reset();
delete global.TEST_UCI.global.apdu_backend;
delete global.TEST_UCI.mbim.skip_slot_mapping;
result = invoke('get_config');
check(result.success && result.data.global.apdu_backend == 'mbim' &&
	result.data.mbim.skip_slot_mapping == '1',
	'missing release options fall back to MBIM with slot mapping skipped');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: sprintf('%J\n', {
		type: 'driver',
		payload: {
			LPAC_APDU: [ 'uqmi', 'stdio', 'mbim', 'uqmi' ],
			LPAC_HTTP: [ 'curl', 'stdio' ]
		}
	})
};
result = invoke('get_drivers');
same(result.data, { apdu: [ 'uqmi', 'mbim' ], http: [ 'curl' ] },
	'driver response is allowlisted and deduplicated');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: sprintf('%J\n', { type: 'driver', payload: { LPAC_APDU: [] } })
};
result = invoke('get_drivers');
check(!result.success && result.error == 'invalid_response',
	'incomplete driver schemas are rejected');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal({
		eidValue: '89012345678901234567890123456789',
		EuiccConfiguredAddresses: {},
		EUICCInfo2: {}
	})
};
result = invoke('get_info');
check(result.success && result.data.eidValue == '89012345678901234567890123456789',
	'chip information requires and preserves a valid EID');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal({ EUICCInfo2: {} }) };
result = invoke('get_info');
check(!result.success && result.error == 'invalid_response',
	'chip information without a valid EID is rejected');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal([]) };
result = invoke('list_profiles');
check(result.success && global.TEST_LOCK_EXISTS &&
	global.TEST_LOCK_MODE == 0o600 && global.TEST_CHMOD?.mode == 0o600,
	'eUICC operations create and enforce a mode-0600 lock file');

reset();
global.TEST_LOCK_EXISTS = true;
global.TEST_LOCK_MODE = 0o644;
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal([]) };
result = invoke('list_profiles');
check(result.success && global.TEST_LOCK_MODE == 0o600,
	'a pre-existing permissive lock file is repaired before execution');

reset();
global.TEST_LOCK_EXISTS = true;
global.TEST_LOCK_TYPE = 'symlink';
result = invoke('list_profiles');
check(!result.success && result.error == 'lock_failed' &&
	global.TEST_LAST_CALL === null,
	'non-regular lock paths are rejected before process execution');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([
		{
			iccid: '8912345678901234567',
			isdpAid: 'A0000005591010FFFFFFFF8900001000',
			profileState: 'disabled',
			profileNickname: 'Test',
			serviceProviderName: 'Carrier',
			profileName: 'Plan',
			iconType: 'png',
			icon: 'sensitive-base64-icon',
			profileClass: 'operational'
		},
		{ iccid: '../../invalid', isdpAid: null }
	])
};
result = invoke('list_profiles');
check(result.success && length(result.data) == 1, 'invalid profile records are discarded');
check(!('icon' in result.data[0]), 'profile icons are never returned to LuCI');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([
		{ seqNumber: 0, profileManagementOperation: 'install' },
		{ seqNumber: 4294967295, profileManagementOperation: 'delete' }
	])
};
result = invoke('list_notifications');
check(result.success && length(result.data) == 2 &&
	result.data[0].seqNumber == 0 && result.data[1].seqNumber == 4294967295,
	'notification list preserves the full uint32 sequence range');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(null) };
result = invoke('remove_notification', { seq: '4294967295' });
check(result.success, 'UINT32_MAX notification can be removed');
	same(global.TEST_LAST_CALL.request.params,
		[ '-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
		'notification', 'remove', '4294967295' ],
	'flock and notification arguments remain separate argv elements');
check(!invoke('remove_notification', { seq: '0' }).success &&
	!invoke('remove_notification', { seq: '01' }).success &&
	!invoke('remove_notification', { seq: '4294967296' }).success,
	'invalid notification sequences are rejected');

reset();
result = invoke('enable_profile', {
	iccid: 'A0000005591010FFFFFFFF8900001000',
	refresh: true
});
check(!result.success && result.error == 'execution_failed',
	'missing lpac output is handled without exposing process data');
same(global.TEST_LAST_CALL.request.params, [
	'-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac', 'profile', 'enable',
	'A0000005591010FFFFFFFF8900001000', '1'
], 'flock, profile AID, and refresh flag remain separate argv elements');
check(!invoke('enable_profile', {
	iccid: '891234567890123456789',
	refresh: false
}).success, 'ICCID longer than the lpac 20-digit buffer is rejected');
check(!invoke('nickname_profile', {
	iccid: 'A0000005591010FFFFFFFF8900001000',
	nickname: 'Alias'
}).success, 'nickname operation requires an ICCID');

reset();
global.TEST_EXEC_REPLY = { code: 1, stdout: '' };
result = invoke('list_profiles');
check(!result.success && result.error == 'busy', 'concurrent eUICC access is rejected');
check(global.TEST_LAST_CALL.request.command == '/usr/bin/flock',
	'eUICC operations are serialized by inherited flock');

reset();
global.TEST_LOCK_BUSY = true;
result = invoke('set_config', { config: default_config() });
check(!result.success && result.error == 'busy',
	'configuration writes share the eUICC operation lock');
check(global.TEST_LOCK_CLOSED, 'busy configuration lock handle is closed');

reset();
global.TEST_EXEC_STATUS = 7;
result = invoke('list_profiles');
check(!result.success && result.error == 'timeout', 'file.exec timeout is normalized');

reset();
global.TEST_EXEC_REPLY = { code: 1, stdout: terminal('private detail', -1) };
result = invoke('delete_profile', { iccid: '8912345678901234567' });
check(!result.success && result.error == 'lpac_error' &&
	!('data' in result) && !('reason' in result),
	'unknown lpac error payload is not returned');

reset();
global.TEST_EXEC_REPLY = {
	code: 255,
	stdout: terminal('profile not in disabled state', -1)
};
result = invoke('enable_profile', {
	iccid: '8912345678901234567',
	refresh: false
});
check(!result.success && result.error == 'lpac_error' &&
	result.reason == 'profile_not_disabled' && !('data' in result),
	'known profile errors are mapped to safe reason codes');

reset();
global.TEST_EXEC_REPLY = {
	code: 255,
	stdout: terminal('iccid or aid not found', -1)
};
result = invoke('delete_profile', { iccid: '8912345678901234567' });
check(!result.success && result.error == 'lpac_error' &&
	!('reason' in result) && !('data' in result),
	'identifier hints are limited to operations that offer both identifiers');

reset();
let config = default_config();
config.at.device = '/dev/ttyUSB2;reboot';
result = invoke('set_config', { config });
check(!result.success && result.error == 'invalid_config',
	'shell-like device paths are rejected');

reset();
config = default_config();
config.global.custom_isd_r_aid = 'A000000559';
result = invoke('set_config', { config });
check(!result.success && result.error == 'invalid_config',
	'short custom ISD-R AIDs are rejected');

reset();
config = default_config();
config.global.apdu_backend = 'mbim';
config.global.custom_isd_r_aid = 'a0000005591010ffffffff8900000100';
result = invoke('set_config', { config });
check(result.success && global.TEST_UCI.global.apdu_backend == 'mbim' &&
	global.TEST_UCI.global.custom_isd_r_aid == 'A0000005591010FFFFFFFF8900000100',
	'validated settings are committed and canonicalized');

reset();
config = default_config();
config.global.apdu_backend = 'at';
config.at.device = '/dev/serial/by-id/usb-Test_Modem-if00';
config.uqmi.device = '/dev/wwan0qmi0';
result = invoke('set_config', { config });
check(result.success && global.TEST_UCI.at.device == config.at.device,
	'safe serial symlinks and inactive backend device paths are accepted');

reset();
config = default_config();
config.global.apdu_backend = 'uqmi';
config.uqmi.device = '/dev/wwan0qmi0';
result = invoke('set_config', { config });
check(!result.success && result.error == 'invalid_config',
	'active uqmi backend retains its strict control-device allowlist');

reset();
config = default_config();
config.global.apdu_backend = 'at';
config.at.device = '/dev/serial/../ttyUSB0';
result = invoke('set_config', { config });
check(!result.success && result.error == 'invalid_config',
	'device paths containing traversal components are rejected');

reset();
config = default_config();
config.mbim.skip_slot_mapping = '0';
result = invoke('set_config', { config });
check(result.success && global.TEST_UCI.mbim.skip_slot_mapping == '0',
	'MBIM slot-mapping preference is validated and committed');

reset();
global.TEST_UCI.mbim.vendor_mode = 'keep';
result = invoke('set_config', { config: default_config() });
check(result.success && global.TEST_UCI.mbim.vendor_mode == 'keep',
	'unmanaged vendor options are preserved by settings writes');

reset();
config = default_config();
config.mbim.skip_slot_mapping = 'yes';
result = invoke('set_config', { config });
check(!result.success && result.error == 'invalid_config',
	'invalid MBIM slot-mapping flags are rejected');

reset();
global.TEST_UCI_LOAD_FAIL = true;
result = invoke('list_profiles');
check(!result.success && result.error == 'invalid_config' &&
	global.TEST_LAST_CALL === null,
	'invalid UCI prevents eUICC process execution');

reset();
global.TEST_UCI_LOAD_FAIL = true;
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal('v2.3.0') };
result = invoke('get_version');
check(result.success && result.data == 'v2.3.0',
	'backend does not pre-block version queries when UCI cannot load');

reset();
global.TEST_UCI.uqmi.device = [ '/dev/cdc-wdm0', '/dev/cdc-wdm0;reboot' ];
result = invoke('list_profiles');
check(!result.success && result.error == 'invalid_config' &&
	global.TEST_LAST_CALL === null,
	'UCI list values cannot bypass scalar path validation');

reset();
const activation_code =
	'lpa:1$smdp.example.com$MATCHING-ID$1.2.840.113549$1';
const confirmation_code = 'confirm-secret';
result = activation_download(activation_code, confirmation_code, '1234567890123456');
check(result.success && result.data.status == 'running' &&
	type(result.data.job_id) == 'int',
	'activation-code downloads start as asynchronous jobs');
const activation_job_id = result.data.job_id;
check(global.TEST_ACCESS.path == '/usr/bin/lpac' &&
	global.TEST_ACCESS.mode == 'x',
	'download startup verifies that the packaged lpac entrypoint is executable');
check(global.TEST_LOCK_FLAGS == 'xn' && global.TEST_LOCK_CLOSED,
	'download startup acquires the shared nonblocking lock and closes the parent handle');
check(length(global.TEST_TASKS) == 1 && global.TEST_SYSTEM_CALL === null,
	'download startup returns before invoking lpac');
result = invoke('get_download_status', { job_id: activation_job_id });
check(result.success && result.data.status == 'running',
	'running download jobs can be polled without exposing arguments');
complete_download(0);
same(global.TEST_SYSTEM_CALL.argv, [
	'/usr/bin/lpac', 'profile', 'download', '-a',
	'LPA:1$smdp.example.com$MATCHING-ID$1.2.840.113549$1',
	'-i', '1234567890123456', '-c', confirmation_code
], 'lowercase LPA schemes are normalized and literal dollar signs stay in one argv element');
check(global.TEST_SYSTEM_CALL.timeout == 600000,
	'profile downloads use the bounded ten-minute worker timeout');
same(global.TEST_REDIRECT_EVENTS, [
	'open:/dev/null:w', 'fileno:9', 'dup2:9:1', 'dup2:1:2',
	'close:9', 'system'
], 'worker stdout and stderr are redirected and the high sink closes before system');
check(global.TEST_DEVNULL_OPEN.path == '/dev/null' &&
	global.TEST_DEVNULL_OPEN.mode == 'w' && global.TEST_DEVNULL_CLOSED &&
	global.TEST_DEVNULL_CLOSE_ATTEMPTS == 1 && global.TEST_LOCK_CLOSE_COUNT == 2,
	'the worker uses one writable devnull sink and releases its inherited lock');
result = invoke('get_download_status', { job_id: activation_job_id });
check(result.success && result.data.status == 'success' &&
	index(sprintf('%J', result), confirmation_code) < 0 &&
	index(sprintf('%J', result), 'MATCHING-ID') < 0,
	'success polling returns no activation or confirmation secret');

reset();
result = activation_download('LPA:1$smdp.example.com$', '', '');
check(result.success && result.data.status == 'running',
	'activation codes accept an empty optional matching ID like upstream lpac');
const empty_matching_job_id = result.data.job_id;
complete_download(0);
same(global.TEST_SYSTEM_CALL.argv, [
	'/usr/bin/lpac', 'profile', 'download', '-a',
	'LPA:1$smdp.example.com$'
], 'an empty activation-code matching ID is preserved in its exact argv element');
result = invoke('get_download_status', { job_id: empty_matching_job_id });
check(result.success && result.data.status == 'success',
	'activation downloads without a matching ID complete normally');

reset();
global.TEST_DEVNULL_FD = 2;
result = manual_download('smdp.example.com', 'LOW-FD', '', '');
check(result.success, 'downloads start when broken task stdio causes devnull to reuse fd 2');
const low_sink_job_id = result.data.job_id;
complete_download(0);
same(global.TEST_REDIRECT_EVENTS, [
	'open:/dev/null:w', 'fileno:2', 'dup2:2:1', 'dup2:1:2', 'system'
], 'a low devnull source is retained through system instead of closing stderr');
result = invoke('get_download_status', { job_id: low_sink_job_id });
check(result.success && result.data.status == 'success' &&
	global.TEST_DEVNULL_CLOSE_ATTEMPTS == 0,
	'fd-2 redirection completes without explicitly closing the live source');

reset();
result = manual_download('[2001:db8::1]:443', 'MANUAL-ID', '1234',
	'12345678901234');
check(result.success && result.data.status == 'running',
	'manual downloads accept explicit SM-DP+, matching ID, confirmation code, and IMEI');
const manual_job_id = result.data.job_id;
complete_download(0);
same(global.TEST_SYSTEM_CALL.argv, [
	'/usr/bin/lpac', 'profile', 'download',
	'-s', '[2001:db8::1]:443', '-m', 'MANUAL-ID',
	'-i', '12345678901234', '-c', '1234'
], 'manual download options remain distinct fixed argv elements');
result = invoke('get_download_status', { job_id: activation_job_id });
check(result.success && result.data.status == 'success',
	'a completed job remains pollable after a later download starts');

reset();
result = manual_download('', '', '', '');
check(result.success && result.data.status == 'running',
	'manual mode may use the eUICC default SM-DP+ without optional flags');
const default_server_job_id = result.data.job_id;
complete_download(0);
same(global.TEST_SYSTEM_CALL.argv,
	[ '/usr/bin/lpac', 'profile', 'download' ],
	'an empty manual request mirrors the upstream default-server invocation');
result = invoke('get_download_status', { job_id: default_server_job_id });
check(result.success && result.data.status == 'success',
	'default-server download completion is reported');

reset();
result = manual_download('', 'MATCH-ONLY', '', '');
check(result.success, 'manual mode accepts an independently supplied matching ID');
const matching_only_job_id = result.data.job_id;
complete_download(0);
same(global.TEST_SYSTEM_CALL.argv,
	[ '/usr/bin/lpac', 'profile', 'download', '-m', 'MATCH-ONLY' ],
	'matching-ID-only downloads omit the SM-DP+ flag');
check(invoke('get_download_status', { job_id: matching_only_job_id }).success,
	'matching-ID-only completion is pollable');

reset();
result = activation_download('LPA:1$smdp.example.com$MATCH$OID$1', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'activation codes that require confirmation are rejected without a confirmation code');
result = activation_download('LPA:1$smdp.example.com$BAD_ID', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'activation-code matching IDs use the same strict format as upstream lpac');
result = activation_download('LPA:1$smdp.example.com/path$MATCH', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'activation-code SM-DP+ values containing URL paths are rejected');
result = activation_download('LPA:1$smdp.example.com$MATCH\nSECOND', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'activation codes containing control characters are rejected');
result = activation_download(make_text('A', 4097), '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'oversized activation codes are rejected before task creation');

reset();
result = manual_download('smdp.example.com/endpoint', 'MATCH', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'manual SM-DP+ URL paths are rejected');
result = manual_download('smdp.example.com', 'BAD_ID', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'manual matching IDs containing punctuation are rejected');
result = manual_download('smdp.example.com', 'MATCH', 'bad\ncode', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'confirmation codes containing control characters are rejected');
result = manual_download('smdp.example.com', 'MATCH', '', '1234');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'invalid IMEI lengths are rejected');
result = invoke('download_profile', {
	mode: 'manual',
	activation_code: 'LPA:1$smdp.example.com$MATCH',
	smdp: 'smdp.example.com',
	matching_id: 'MATCH',
	imei: '',
	confirmation_code: ''
});
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'manual mode cannot mix an activation code with separate parameters');
result = invoke('download_profile', {
	mode: 'other',
	activation_code: '',
	smdp: '',
	matching_id: '',
	imei: '',
	confirmation_code: ''
});
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_TASK === null,
	'unknown download modes are rejected');

reset();
result = manual_download('smdp.example.com', 'FIRST', 'do-not-return', '');
check(result.success, 'a download can be started for concurrency checks');
const busy_job_id = result.data.job_id;
const busy_task = global.TEST_LAST_TASK;
result = manual_download('smdp.example.com', 'SECOND', '', '');
check(!result.success && result.error == 'busy' &&
	length(global.TEST_TASKS) == 1 &&
	index(sprintf('%J', result), 'FIRST') < 0,
	'duplicate download requests are rejected without leaking the active secret');
global.TEST_LOCK_BUSY = true;
result = invoke('set_config', { config: default_config() });
check(!result.success && result.error == 'busy',
	'the inherited download lock serializes configuration changes');
global.TEST_LOCK_BUSY = false;
global.TEST_LAST_TASK = busy_task;
complete_download(0);
check(invoke('get_download_status', { job_id: busy_job_id }).success,
	'the active job still completes after rejected concurrent operations');

reset();
global.TEST_LOCK_BUSY = true;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'busy' &&
	global.TEST_LAST_TASK === null && global.TEST_LOCK_CLOSED,
	'a busy shared lock prevents task creation and closes its handle');

reset();
global.TEST_UCI_LOAD_FAIL = true;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'invalid_config' &&
	global.TEST_ACCESS === null && global.TEST_LAST_TASK === null,
	'invalid UCI prevents executable checks, locking, and task creation');

reset();
global.TEST_LPAC_ACCESS = false;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'not_installed' &&
	global.TEST_LAST_TASK === null && !global.TEST_LOCK_EXISTS,
	'a missing or non-executable lpac entrypoint is detected before locking');

reset();
global.TEST_TASK_NULL = true;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'execution_failed' &&
	global.TEST_LOCK_CLOSED,
	'a null uloop task result is normalized and releases the parent lock');
global.TEST_TASK_NULL = false;
result = manual_download('smdp.example.com', 'RECOVERY', '', '');
check(result.success, 'task startup failure does not leave a stale running job');
const recovered_job_id = result.data.job_id;
complete_download(0);
check(invoke('get_download_status', { job_id: recovered_job_id }).success,
	'a job can complete after recovery from task startup failure');

reset();
global.TEST_TASK_THROW = true;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'execution_failed' &&
	global.TEST_LOCK_CLOSED,
	'a thrown uloop task startup error is normalized and releases the lock');

check_redirection_failure(function() {
	global.TEST_DEVNULL_OPEN_FAIL = true;
}, [ 'open:/dev/null:w' ], 'devnull open failure');

check_redirection_failure(function() {
	global.TEST_DEVNULL_FILENO_FAIL = true;
}, [
	'open:/dev/null:w', 'fileno:9', 'close:9'
], 'devnull descriptor failure');

check_redirection_failure(function() {
	global.TEST_DUP2_FAIL_TARGET = 1;
}, [
	'open:/dev/null:w', 'fileno:9', 'dup2:9:1', 'close:9'
], 'stdout redirection failure');

check_redirection_failure(function() {
	global.TEST_DUP2_FAIL_TARGET = 2;
}, [
	'open:/dev/null:w', 'fileno:9', 'dup2:9:1', 'dup2:1:2', 'close:9'
], 'stderr redirection failure');

check_redirection_failure(function() {
	global.TEST_DEVNULL_CLOSE_FAIL = true;
}, [
	'open:/dev/null:w', 'fileno:9', 'dup2:9:1', 'dup2:1:2', 'close:9'
], 'devnull close failure');

reset();
result = manual_download('smdp.example.com', 'MATCH', 'worker-secret', '');
const worker_failure_job_id = result.data.job_id;
global.TEST_SYSTEM_THROW = true;
complete_download(0);
result = invoke('get_download_status', { job_id: worker_failure_job_id });
check(!result.success && result.error == 'execution_failed' &&
	index(sprintf('%J', result), 'worker-secret') < 0,
	'worker execution exceptions are reported without treating them as lpac errors or leaking secrets');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const timeout_job_id = result.data.job_id;
complete_download(-9);
result = invoke('get_download_status', { job_id: timeout_job_id });
check(!result.success && result.error == 'timeout' && !('code' in result),
	'the worker timeout signal is mapped without exposing a raw negative code');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const wrapper_missing_job_id = result.data.job_id;
complete_download(127);
result = invoke('get_download_status', { job_id: wrapper_missing_job_id });
check(!result.success && result.error == 'not_installed',
	'a packaged wrapper that cannot exec its lpac binary is mapped as not installed');

reset();
result = manual_download('smdp.example.com', 'MATCH', 'failure-secret', '');
const lpac_failure_job_id = result.data.job_id;
complete_download(17);
result = invoke('get_download_status', { job_id: lpac_failure_job_id });
check(!result.success && result.error == 'lpac_error' && result.code == 17 &&
	index(sprintf('%J', result), 'failure-secret') < 0,
	'nonzero lpac exits return only a generic error and numeric code');

reset();
result = manual_download('smdp.example.com', 'MATCH', 'lost-secret', '');
const missing_result_job_id = result.data.job_id;
global.TEST_LAST_TASK.finished = true;
result = invoke('get_download_status', { job_id: missing_result_job_id });
check(!result.success && result.error == 'execution_failed' &&
	index(sprintf('%J', result), 'lost-secret') < 0,
	'a finished task with no serialized result becomes a redacted execution failure');

reset();
result = invoke('get_download_status', { job_id: 2147483647 });
check(!result.success && result.error == 'job_not_found',
	'unknown but well-formed download job IDs are rejected');
check(!invoke('get_download_status', { job_id: 0 }).success &&
	!invoke('get_download_status', { job_id: '1' }).success &&
	!invoke('get_download_status', { job_id: 2147483648 }).success,
	'malformed or out-of-range download job IDs are rejected');

printf(`1..${checks}\n`);
