// SPDX-License-Identifier: Apache-2.0

'use strict';

const DOWNLOAD_EXIT_SUCCESS = 64;
const DOWNLOAD_EXIT_NOT_FOUND = 65;
const DOWNLOAD_EXIT_NOT_EXECUTABLE = 66;
const DOWNLOAD_EXIT_FAILED = 67;
const DOWNLOAD_EXIT_SIGNALED = 68;
const DOWNLOAD_EXIT_PIPE_FAILED = 69;

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
	global.TEST_LOCK_OPEN = null;
	global.TEST_RANDOM_OPEN_FAIL = false;
	global.TEST_RANDOM_READ_FAIL = false;
	global.TEST_RANDOM_OPEN_COUNT = 0;
	global.TEST_RANDOM_READ_COUNT = 0;
	global.TEST_RANDOM_CLOSE_COUNT = 0;
	global.TEST_FD_COUNTER = 8;
	global.TEST_FD_STATES = {};
	global.TEST_PIPE_HANDLES = [];
	global.TEST_PIPES = [];
	global.TEST_OUTPUT_PIPE = null;
	global.TEST_PIPE_CALL_COUNT = 0;
	global.TEST_PIPE_THROW = false;
	global.TEST_PIPE_NULL = false;
	global.TEST_PIPE_CLONE_FAIL = false;
	global.TEST_PIPE_FILENO_THROW = false;
	global.TEST_PIPE_READ_THROW = false;
	global.TEST_PIPE_WRITE_THROW = false;
	global.TEST_PIPE_WRITE_PARTIAL = false;
	global.TEST_PIPE_FLUSH_THROW = false;
	global.TEST_PIPE_FLUSH_RESULT = true;
	global.TEST_PIPE_FLUSH_COUNT = 0;
	global.TEST_PIPE_CLOSE_COUNT = 0;
	global.TEST_DECISION_WRITES = [];
	global.TEST_PROC_OPEN_CALLS = [];
	global.TEST_DEFER_THROW = false;
	global.TEST_DEFER_NULL = false;
	global.TEST_EXEC_STATUS = 0;
	global.TEST_EXEC_REPLY = null;
	global.TEST_LAST_CALL = null;
	global.TEST_LPAC_ACCESS = true;
	global.TEST_ACCESS_FAIL_PATH = null;
	global.TEST_ACCESS_CALLS = [];
	global.TEST_PROCESS_THROW = false;
	global.TEST_PROCESS_NULL = false;
	global.TEST_PROCESS_PID_THROW = false;
	global.TEST_PROCESS_PID = 4321;
	global.TEST_PROCESSES = [];
	global.TEST_LAST_PROCESS = null;
	global.TEST_TIMER_THROW = false;
	global.TEST_TIMER_NULL = false;
	global.TEST_TIMER_NULL_AT = 0;
	global.TEST_TIMER_CALL_COUNT = 0;
	global.TEST_TIMER_SET_THROW = false;
	global.TEST_TIMER_SET_FAIL = false;
	global.TEST_TIMER_SET_COUNT = 0;
	global.TEST_TIMERS = [];
	global.TEST_LAST_TIMER = null;
	global.TEST_TIMER_CANCEL_COUNT = 0;
	global.TEST_HANDLE_THROW = false;
	global.TEST_HANDLE_NULL = false;
	global.TEST_HANDLE_NULL_AT = 0;
	global.TEST_HANDLE_CALL_COUNT = 0;
	global.TEST_HANDLE_DELETE_COUNT = 0;
	global.TEST_HANDLES = [];
	global.TEST_LAST_HANDLE = null;
	global.TEST_SYSTEM_EXIT = 0;
	global.TEST_SYSTEM_EXITS = [];
	global.TEST_SYSTEM_THROW = false;
	global.TEST_SYSTEM_CALLS = [];
	global.system = function(argv, timeout) {
		push(global.TEST_SYSTEM_CALLS, { argv, timeout });

		if (global.TEST_SYSTEM_THROW)
			die('system failed');

		return length(global.TEST_SYSTEM_EXITS)
			? shift(global.TEST_SYSTEM_EXITS)
			: global.TEST_SYSTEM_EXIT;
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

function emit_download_output(fragment) {
	global.TEST_OUTPUT_PIPE.buffer += fragment;
	global.TEST_LAST_HANDLE.callback(1, false, false);
}

function end_download_output() {
	global.TEST_OUTPUT_PIPE.eof = true;
	global.TEST_LAST_HANDLE.callback(1, true, false);
}

function complete_download(exit_code, output) {
	if (type(output) == 'string' && length(output))
		emit_download_output(output);

	global.TEST_LAST_PROCESS.output(exit_code);
	end_download_output();
}

function download_progress(message, data) {
	return sprintf('%J\n', {
		type: 'progress',
		payload: { code: 0, message, data }
	});
}

function owner_status(job_id, decision_token) {
	return invoke('get_download_status', { job_id, decision_token });
}

function make_text(character, count) {
	let value = '';

	for (let i = 0; i < count; i++)
		value += character;

	return value;
}

function terminal(data, code, message) {
	if (type(code) != 'int')
		code = 0;
	if (type(message) != 'string')
		message = code == 0 ? 'success' : 'failure';

	return sprintf('%J\n', {
		type: 'lpa',
		payload: {
			code,
			message,
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
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal({
		eidValue: '89012345678901234567890123456789\n',
		EUICCInfo2: {}
	})
};
result = invoke('get_info');
check(!result.success && result.error == 'invalid_response',
	'an EID with a newline suffix cannot exploit end-anchor behavior');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal({
		eidValue: '89012345678901234567890123456789',
		EUICCInfo2: {
			euiccCiPKIdListForVerification: [ 'A1B2', 'C3D4\n', 'E5F6\r\n' ]
		}
	})
};
result = invoke('get_info');
same(result.data.EUICCInfo2.euiccCiPKIdListForVerification, [ 'A1B2' ],
	'hex-list normalization discards control-suffixed values');

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
const png_icon_data = b64enc(chr(137, 80, 78, 71, 13, 10, 26, 10));
const jpeg_icon_data = b64enc(chr(255, 216, 255, 224));
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
			icon: png_icon_data,
			profileClass: 'operational'
		},
		{
			iccid: '8912345678901234568',
			iconType: 'jpeg',
			icon: jpeg_icon_data
		},
		{ iccid: '../../invalid', isdpAid: null }
	])
};
result = invoke('list_profiles');
check(result.success && length(result.data) == 2,
	'invalid profile records are discarded');
same(result.data[0].icon, { mime: 'image/png', data: png_icon_data },
	'canonical PNG profile icons are returned as typed inert data');
same(result.data[1].icon, { mime: 'image/jpeg', data: jpeg_icon_data },
	'canonical JPEG profile icons are returned as typed inert data');
check(!('iconType' in result.data[0]),
	'raw icon type values are not forwarded alongside normalized icons');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([
		{ iccid: '8912345678901234567\n', isdpAid: null },
		{ iccid: null, isdpAid: 'A0000005591010FFFFFFFF8900001000\n' },
		{ iccid: '8912345678901234567', isdpAid: null }
	])
};
result = invoke('list_profiles');
check(result.success && length(result.data) == 1 &&
	result.data[0].iccid == '8912345678901234567',
	'control-suffixed ICCID and AID profile records are discarded');

reset();
const invalid_icon_profiles = [];
const invalid_icons = [
	{ iconType: 'png', icon: jpeg_icon_data },
	{ iconType: 'jpeg', icon: png_icon_data },
	{ iconType: 'svg', icon: b64enc('<svg onload="alert(1)"/>') },
	{ iconType: 'png', icon: 'data:image/png;base64,' + png_icon_data },
	{ iconType: 'png', icon: png_icon_data + '\n' },
	{ iconType: 'png', icon: substr(png_icon_data, 0,
		length(png_icon_data) - 2) + 'p=' },
	{ iconType: 'png', icon: b64enc(chr(137, 80, 78, 71, 13, 10, 26, 10) +
		make_text('A', 1017)) },
	{ iconType: 'PNG', icon: png_icon_data }
];

for (let i = 0; i < length(invalid_icons); i++) {
	const profile = invalid_icons[i];

	profile.iccid = sprintf('89%017d', i);
	push(invalid_icon_profiles, profile);
}

global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(invalid_icon_profiles) };
result = invoke('list_profiles');
check(result.success && length(result.data) == length(invalid_icons),
	'bad icon data does not discard otherwise valid profile records');
for (let profile in result.data)
	check(!('icon' in profile),
		'wrong MIME, magic, base64, size, or type is never exposed as an icon');

reset();
const icon_budget_profiles = [];
const maximum_png = b64enc(chr(137, 80, 78, 71, 13, 10, 26, 10) +
	make_text('A', 1016));

for (let i = 0; i < 33; i++)
	push(icon_budget_profiles, {
		iccid: sprintf('88%017d', i),
		iconType: 'png',
		icon: maximum_png
	});

global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(icon_budget_profiles) };
result = invoke('list_profiles');
let returned_icons = 0;

for (let profile in result.data)
	if ('icon' in profile)
		returned_icons++;

check(result.success && returned_icons == 32 &&
	!('icon' in result.data[32]),
	'profile-list icon data is capped at a 32-KiB decoded aggregate budget');

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
const discovery_secret = 'secret-event-id-never-returned';
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([
		{ eventId: discovery_secret, rspServerAddress: 'rsp.example.com' },
		{ eventId: discovery_secret, rspServerAddress: 'rsp.example.com' },
		{ eventId: 'second-secret', rspServerAddress: 'rsp2.example.com:443' }
	])
};
result = invoke('discover_profiles', { smds: '', imei: '' });
check(result.success && length(result.data) == 2 &&
	result.data[0].smdp == 'rsp.example.com' &&
	result.data[1].smdp == 'rsp2.example.com:443',
	'discovery returns deduplicated, validated SM-DP+ display addresses');
check(match(result.data[0].entry_id, /^[A-Za-z0-9_-]{32}$/) !== null &&
	match(result.data[1].entry_id, /^[A-Za-z0-9_-]{32}$/) !== null &&
	result.data[0].entry_id != result.data[1].entry_id &&
	index(sprintf('%J', result), discovery_secret) < 0 &&
	index(sprintf('%J', result), 'second-secret') < 0,
	'discovery event IDs are replaced with distinct opaque in-memory tokens');
same(global.TEST_LAST_CALL.request.params, [
	'-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
	'profile', 'discovery', '-j'
], 'default discovery uses detailed JSON without injecting a default SM-DS flag');
check(global.TEST_RANDOM_OPEN_COUNT == 2 &&
	global.TEST_RANDOM_CLOSE_COUNT == 2,
	'each unique discovery result receives fresh randomness from a closed handle');
const first_discovery_timer = global.TEST_TIMERS[0];
check(length(global.TEST_TIMERS) == 1 &&
	first_discovery_timer.timeout == 300000 &&
	length(first_discovery_timer.set_calls) == 1,
	'discovery secrets receive one real five-minute expiry watchdog');

result = invoke('discover_profiles', { smds: '', imei: '' });
const expiring_entry_id = result.data[0].entry_id;
const replacement_discovery_timer = global.TEST_TIMERS[1];
check(result.success && first_discovery_timer.cancelled &&
	length(global.TEST_TIMERS) == 2 &&
	replacement_discovery_timer.timeout == 300000,
	'a replacement discovery cancels the previous secret-expiry watchdog');
result = invoke('download_discovered_profile', {
	entry_id: expiring_entry_id + '\n', confirmation_code: ''
});
check(!result.success && result.error == 'invalid_argument',
	'a control-suffixed discovery entry token is rejected at the RPC boundary');
replacement_discovery_timer.callback();
result = invoke('download_discovered_profile', {
	entry_id: expiring_entry_id, confirmation_code: ''
});
check(!result.success && result.error == 'entry_unavailable' &&
	global.TEST_LAST_PROCESS === null,
	'the five-minute watchdog hard-deletes event IDs and IMEI without lazy access');

reset();
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([
		{ eventId: 'ipv6-event', rspServerAddress: '[2001:db8::2]:8443' }
	])
};
result = invoke('discover_profiles', {
	smds: '[2001:db8::1]:443',
	imei: '1234567890123456'
});
check(result.success && index(sprintf('%J', result), '1234567890123456') < 0,
	'discovery accepts but never returns the validated IMEI retained for preview');
same(global.TEST_LAST_CALL.request.params, [
	'-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
	'profile', 'discovery', '-j', '-s', '[2001:db8::1]:443',
	'-i', '1234567890123456'
], 'SM-DS and IMEI remain separate fixed discovery argv elements');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal([]) };
result = invoke('discover_profiles', { smds: 'lpa.ds.gsma.com', imei: '' });
check(result.success && length(result.data) == 0,
	'an empty detailed discovery array is a valid no-results response');

reset();
const bad_discovery_arguments = [
	{ smds: '-a', imei: '' },
	{ smds: 'smds.example.com/path', imei: '' },
	{ smds: 'smds.example.com\n-i', imei: '' },
	{ smds: 'smds_example.com', imei: '' },
	{ smds: '-smds.example.com', imei: '' },
	{ smds: 'smds.example.com:0', imei: '' },
	{ smds: 'smds.example.com:65536', imei: '' },
	{ smds: '999.999.999.999', imei: '' },
	{ smds: '[2001:::1]', imei: '' },
	{ smds: make_text('a', 64) + '.example.com', imei: '' },
	{ smds: [ 'smds.example.com' ], imei: '' },
	{ smds: 'smds.example.com', imei: '1234567890123' },
	{ smds: 'smds.example.com', imei: '12345678901234567' },
	{ smds: 'smds.example.com', imei: '12345678901234\n' },
	{ smds: 'smds.example.com', imei: 12345678901234 }
];

for (let args in bad_discovery_arguments) {
	result = invoke('discover_profiles', args);
	check(!result.success && result.error == 'invalid_argument' &&
		global.TEST_LAST_CALL === null,
		'malformed discovery host, port, IMEI, or argv injection is rejected');
}

const too_many_discovery_entries = [];

for (let i = 0; i < 65; i++)
	push(too_many_discovery_entries, {
		eventId: `event-${i}`,
		rspServerAddress: 'rsp.example.com'
	});

const malformed_discovery_payloads = [
	{},
	[ 'rsp.example.com' ],
	[ null ],
	[ {} ],
	[ { eventId: '', rspServerAddress: 'rsp.example.com' } ],
	[ { eventId: 123, rspServerAddress: 'rsp.example.com' } ],
	[ { eventId: 'event', rspServerAddress: null } ],
	[ { eventId: 'bad\nevent', rspServerAddress: 'rsp.example.com' } ],
	[ { eventId: make_text('E', 4097), rspServerAddress: 'rsp.example.com' } ],
	[ { eventId: 'event', rspServerAddress: 'https://rsp.example.com/path' } ],
	[ { eventId: 'event', rspServerAddress: 'rsp_example.com' } ],
	[ { eventId: 'event', rspServerAddress: '999.999.999.999' } ],
	[ { eventId: 'event', rspServerAddress: 'rsp.example.com\nsecond' } ],
	too_many_discovery_entries
];

for (let payload in malformed_discovery_payloads) {
	reset();
	global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(payload) };
	result = invoke('discover_profiles', { smds: '', imei: '' });
	check(!result.success && result.error == 'invalid_response' &&
		index(sprintf('%J', result), 'event') < 0,
		'malformed, legacy, or oversized detailed discovery payload is rejected');
}

reset();
global.TEST_RANDOM_OPEN_FAIL = true;
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([
		{ eventId: discovery_secret, rspServerAddress: 'rsp.example.com' }
	])
};
result = invoke('discover_profiles', { smds: '', imei: '' });
check(!result.success && result.error == 'execution_failed' &&
	index(sprintf('%J', result), discovery_secret) < 0 &&
	global.TEST_RANDOM_OPEN_COUNT == 8,
	'discovery fails closed without exposing secrets when entropy is unavailable');

reset();
global.TEST_TIMER_NULL_AT = 1;
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([ {
		eventId: discovery_secret,
		rspServerAddress: 'rsp.example.com'
	} ])
};
result = invoke('discover_profiles', { smds: '', imei: '' });
check(!result.success && result.error == 'execution_failed' &&
	!('data' in result) && index(sprintf('%J', result), discovery_secret) < 0,
	'discovery returns no token or secret when expiry-timer creation fails');
const failed_timer_entry_id = replace(replace(
	b64enc(sprintf('%024d', 1)), /\+/g, '-'), /\//g, '_');
result = invoke('download_discovered_profile', {
	entry_id: failed_timer_entry_id, confirmation_code: ''
});
check(!result.success && result.error == 'entry_unavailable',
	'timer-creation failure wipes the generated discovery secret');

reset();
global.TEST_TIMER_SET_FAIL = true;
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([ {
		eventId: discovery_secret,
		rspServerAddress: 'rsp.example.com'
	} ])
};
result = invoke('discover_profiles', { smds: '', imei: '' });
check(!result.success && result.error == 'execution_failed' &&
	!('data' in result) && length(global.TEST_TIMERS) == 1 &&
	global.TEST_TIMERS[0].cancelled,
	'discovery fails closed and cancels a watchdog that cannot be armed');
result = invoke('download_discovered_profile', {
	entry_id: failed_timer_entry_id, confirmation_code: ''
});
check(!result.success && result.error == 'entry_unavailable',
	'timer-set failure wipes event IDs instead of retaining unbounded secrets');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(null) };
result = invoke('set_default_smdp', { address: 'rsp.default.example.com:443' });
check(result.success && result.data === null,
	'a validated default SM-DP+ address can be updated');
same(global.TEST_LAST_CALL.request.params,
	[ '-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
		'chip', 'defaultsmdp', 'rsp.default.example.com:443' ],
	'default SM-DP+ update uses fixed argv under the shared eUICC lock');
for (let address in [
	'', '-a', 'https://rsp.example.com', 'rsp.example.com/path',
	'rsp_example.com', 'rsp.example.com\nsecond', 'rsp.example.com:0'
]) {
	result = invoke('set_default_smdp', { address });
	check(!result.success && result.error == 'invalid_argument',
		sprintf('invalid default SM-DP+ %J is rejected (success=%J error=%J)',
			address, result.success, result.error));
}

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(null) };
result = invoke('remove_notification', { seq: '4294967295' });
check(result.success, 'UINT32_MAX notification can be removed');
same(global.TEST_LAST_CALL.request.params,
	[ '-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
		'notification', 'remove', '4294967295' ],
	'flock and notification arguments remain separate argv elements');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(null) };
result = invoke('remove_notification', { seq: '0' });
check(result.success, 'notification sequence zero can be removed');
same(global.TEST_LAST_CALL.request.params,
	[ '-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
		'notification', 'remove', '0' ],
	'notification sequence zero remains a canonical argv element');
check(!invoke('remove_notification', { seq: '00' }).success &&
	!invoke('remove_notification', { seq: '01' }).success &&
	!invoke('remove_notification', { seq: '+1' }).success &&
	!invoke('remove_notification', { seq: 0 }).success &&
	!invoke('remove_notification', { seq: '4294967296' }).success,
	'invalid notification sequences are rejected');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal(null) };
result = invoke('process_notification', {
	seq: '0',
	remove_after_success: false
});
check(result.success && result.data === null,
	'notification sequence zero can be processed without removal');
same(global.TEST_LAST_CALL.request.params,
	[ '-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
		'notification', 'process', '0' ],
	'processing without removal uses one canonical sequence argument');

reset();
global.TEST_EXEC_REPLY = { code: 0, stdout: terminal('provider-private-data') };
result = invoke('process_notification', {
	seq: '4294967295',
	remove_after_success: true
});
check(result.success && result.data === null &&
	index(sprintf('%J', result), 'provider-private-data') < 0,
	'notification processing normalizes success without forwarding provider data');
same(global.TEST_LAST_CALL.request.params,
	[ '-n', '/var/run/luci-lpac.lock', '/usr/bin/lpac',
		'notification', 'process', '-r', '4294967295' ],
	'removal is requested only through the fixed process -r flag');
check(!invoke('process_notification', {
	seq: '01', remove_after_success: false
}).success && !invoke('process_notification', {
	seq: '1', remove_after_success: 'true'
}).success && !invoke('process_notification', {
	seq: '4294967296', remove_after_success: true
}).success,
	'notification processing rejects non-canonical sequences and non-boolean flags');

const notification_stage_failures = [
	{
		stage: 'es10b_retrieve_notifications_list',
		reason: 'notification_retrieve_failed'
	},
	{
		stage: 'es9p_handle_notification',
		reason: 'provider_outcome_unknown'
	},
	{
		stage: 'es10b_remove_notification_from_list',
		reason: 'provider_processed_remove_failed'
	}
];

for (let failure_case in notification_stage_failures) {
	reset();
	global.TEST_EXEC_REPLY = {
		code: 255,
		stdout: terminal('provider-private-detail', -1, failure_case.stage)
	};
	result = invoke('process_notification', {
		seq: '7', remove_after_success: true
	});
	check(!result.success && result.error == 'lpac_error' &&
		result.reason == failure_case.reason && !('code' in result) &&
		index(sprintf('%J', result), failure_case.stage) < 0 &&
		index(sprintf('%J', result), 'provider-private-detail') < 0,
		'exact notification failure stages map to safe retry-state reasons');
}

for (let stage in [
	'es9p_handle_notification_extra',
	'ES9P_HANDLE_NOTIFICATION',
	'unknown-provider-stage'
]) {
	reset();
	global.TEST_EXEC_REPLY = {
		code: 255,
		stdout: terminal('do-not-forward', -1, stage)
	};
	result = invoke('process_notification', {
		seq: '7', remove_after_success: false
	});
	check(!result.success && result.error == 'lpac_error' &&
		result.reason == 'provider_outcome_unknown' && !('code' in result) &&
		index(sprintf('%J', result), stage) < 0 &&
		index(sprintf('%J', result), 'do-not-forward') < 0,
		'unknown or spoofed notification stages remain redacted and uncertain');
}

reset();
global.TEST_EXEC_STATUS = 7;
result = invoke('process_notification', {
	seq: '7', remove_after_success: false
});
check(!result.success && result.error == 'timeout' &&
	result.reason == 'provider_outcome_unknown',
	'notification execution timeout never encourages a blind provider retry');

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
reset();
check(!invoke('enable_profile', {
	iccid: '8912345678901234567\n',
	refresh: false
}).success && global.TEST_LAST_CALL === null,
	'a newline-suffixed ICCID never reaches a profile-operation argv');
check(!invoke('disable_profile', {
	iccid: 'A0000005591010FFFFFFFF8900001000\n',
	refresh: false
}).success && global.TEST_LAST_CALL === null,
	'a newline-suffixed AID never reaches a profile-operation argv');
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
	!('data' in result) && !('reason' in result) && !('code' in result),
	'unknown lpac error payload and generic -1 code are not returned');

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

for (let device_case in [
	{ section: 'at', value: '/dev/ttyUSB2\n' },
	{ section: 'uqmi', value: '/dev/cdc-wdm0\n' },
	{ section: 'mbim', value: '/dev/cdc-wdm0\n' }
]) {
	reset();
	config = default_config();
	config[device_case.section].device = device_case.value;
	result = invoke('set_config', { config });
	check(!result.success && result.error == 'invalid_config',
		'control-suffixed AT, UQMI, and MBIM device paths are rejected');
}

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
result = manual_download('smdp.example.com', 'MATCHING-ID\n', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_PROCESS === null,
	'a control-suffixed matching ID is rejected before process creation');
result = manual_download('smdp.example.com', 'MATCHING-ID', '',
	'12345678901234\n');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_PROCESS === null,
	'a control-suffixed download IMEI is rejected before process creation');

reset();
result = activation_download(activation_code, confirmation_code,
	'1234567890123456');
check(result.success && result.data.status == 'running' &&
	result.data.phase == 'authenticating' &&
	match(result.data.decision_token, /^[A-Za-z0-9_-]{32}$/) !== null,
	'interactive activation download returns one opaque owner token');
const activation_job_id = result.data.job_id;
const activation_token = result.data.decision_token;
same(global.TEST_ACCESS_CALLS, [
	{ path: '/usr/bin/lpac', mode: 'x' },
	{ path: '/usr/bin/setsid', mode: 'x' },
	{ path: '/bin/kill', mode: 'x' },
	{ path: '/bin/sh', mode: 'x' }
], 'download startup verifies only fixed packaged supervisor executables');
check(global.TEST_LOCK_FLAGS == 'xn' && global.TEST_LOCK_CLOSED &&
	global.TEST_LOCK_OPEN.mode == 'a' && global.TEST_PIPE_CALL_COUNT == 2 &&
	length(global.TEST_PROC_OPEN_CALLS) >= 2 &&
	global.TEST_PROC_OPEN_CALLS[0].mode == 'we' &&
	global.TEST_PROC_OPEN_CALLS[1].mode == 're',
	'download startup inherits the lock and clones only parent pipe ends CLOEXEC');
check(length(global.TEST_PROCESSES) == 1 && length(global.TEST_TIMERS) == 4 &&
	length(global.TEST_HANDLES) == 1 &&
	global.TEST_TIMERS[0].timeout == 600000,
	'all pipe watchers and disabled watchdogs exist before process supervision');
check(global.TEST_LAST_PROCESS.executable == '/usr/bin/setsid' &&
	global.TEST_LAST_PROCESS.environment.PATH == '/usr/sbin:/usr/bin:/sbin:/bin',
	'downloads run in a fixed isolated process-group environment');
const activation_argv = global.TEST_LAST_PROCESS.arguments;
const activation_lpac_index = index(activation_argv, '/usr/bin/lpac');
check(activation_argv[0] == '/bin/sh' && activation_argv[1] == '-c' &&
	index(activation_argv[2], '/proc/self/fd/') >= 0 &&
	index(activation_argv[2], confirmation_code) < 0 &&
	match(activation_argv[4], /^[0-9]+$/) !== null &&
	match(activation_argv[5], /^[0-9]+$/) !== null,
	'fixed shell protocol redirects arbitrary high descriptors without secrets');
same(slice(activation_argv, activation_lpac_index), [
	'/usr/bin/lpac', 'profile', 'download', '-p', '-a',
	'LPA:1$smdp.example.com$MATCHING-ID$1.2.840.113549$1',
	'-i', '1234567890123456', '-c', confirmation_code
], 'activation argv always includes the mandatory interactive preview gate');

result = owner_status(activation_job_id, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
check(result.success && result.data.phase == 'authenticating' &&
	!('preview' in result.data) && !('decision_token' in result.data),
	'unauthorized polling receives only a sanitized running phase');
result = invoke('get_download_status', { job_id: 0, decision_token: activation_token });
check(result.success && result.data.phase == 'authenticating' &&
	!('preview' in result.data) && !('decision_token' in result.data),
	'global polling remains sanitized even when supplied the owner token');
result = invoke('respond_download_preview', {
	job_id: activation_job_id,
	decision_token: activation_token,
	accept: true
});
check(!result.success && result.error == 'not_ready' &&
	length(global.TEST_DECISION_WRITES) == 0,
	'a decision cannot be consumed before the explicit preview event');

const preview_png = b64enc(chr(137, 80, 78, 71, 13, 10, 26, 10));
const metadata_event = download_progress('es8p_meatadata_parse', {
	iccid: '8912345678901234567',
	serviceProviderName: 'Preview Carrier',
	profileName: 'Preview Plan',
	profileClass: 'operational',
	iconType: 'png',
	icon: preview_png
});
const preview_event = download_progress('preview', 'y/n');
emit_download_output(substr(metadata_event, 0, 17));
emit_download_output(substr(metadata_event, 17) + substr(preview_event, 0, 9));
emit_download_output(substr(preview_event, 9));
result = owner_status(activation_job_id, activation_token);
check(result.success && result.data.phase == 'awaiting_confirmation' &&
	result.data.preview.serviceProviderName == 'Preview Carrier' &&
	result.data.preview.icon.mime == 'image/png' &&
	result.data.preview.icon.data == preview_png,
	'fragmented metadata and prompt NDJSON yield a strictly normalized preview');
check(global.TEST_TIMERS[1].timeout == 120000 &&
	global.TEST_TIMERS[0].timeout == 130000,
	'prompt grants a fresh full preview window plus cancellation grace');
result = owner_status(activation_job_id, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
check(result.success && result.data.phase == 'awaiting_confirmation' &&
	!('preview' in result.data),
	'wrong-token polling cannot read provider metadata or the null/no-metadata bit');
result = owner_status(activation_job_id, activation_token + '\n');
check(result.success && result.data.phase == 'awaiting_confirmation' &&
	!('preview' in result.data),
	'a control-suffixed owner token cannot disclose preview metadata');
result = invoke('respond_download_preview', {
	job_id: activation_job_id,
	decision_token: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
	accept: true
});
check(!result.success && result.error == 'not_authorized' &&
	length(global.TEST_DECISION_WRITES) == 0,
	'wrong decision token cannot write to lpac stdin');
result = invoke('respond_download_preview', {
	job_id: activation_job_id,
	decision_token: activation_token + '\n',
	accept: true
});
check(!result.success && result.error == 'not_authorized' &&
	length(global.TEST_DECISION_WRITES) == 0,
	'a control-suffixed decision token cannot write to lpac stdin');
result = invoke('respond_download_preview', {
	job_id: activation_job_id,
	decision_token: activation_token,
	accept: true
});
check(result.success && result.data.phase == 'installing' &&
	length(global.TEST_DECISION_WRITES) == 1 &&
	global.TEST_DECISION_WRITES[0] == 'y\n' &&
	global.TEST_TIMERS[0].timeout == 600000,
	'acceptance writes one y line and grants a fresh installation watchdog');
result = invoke('respond_download_preview', {
	job_id: activation_job_id,
	decision_token: activation_token,
	accept: false
});
check(!result.success && result.error == 'invalid_state' &&
	length(global.TEST_DECISION_WRITES) == 1,
	'preview decisions are atomic and cannot be replayed or reversed');

emit_download_output(download_progress('es10b_prepare_download', 'redacted') +
	terminal({ seqNumber: 9, private: confirmation_code }));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_SUCCESS);
result = owner_status(activation_job_id, activation_token);
check(result.success && result.data.status == 'running' &&
	result.data.phase == 'installing',
	'process callback alone cannot finalize before the output pipe reaches EOF');
end_download_output();
result = invoke('get_download_status', { job_id: activation_job_id });
check(result.success && result.data.status == 'success' &&
	result.data.phase == 'complete' &&
	index(sprintf('%J', result), confirmation_code) < 0 &&
	!('decision_token' in result.data),
	'verified success requires terminal success, reserved exit 64, and real EOF');
result = invoke('get_download_status', { job_id: 0 });
check(result.success && result.data.status == 'idle' && result.data.phase == 'idle',
	'global status becomes idle after complete process-and-pipe cleanup');

reset();
result = manual_download('', '', '', '');
const reject_job_id = result.data.job_id;
const reject_token = result.data.decision_token;
emit_download_output(download_progress('preview', 'y/n'));
result = owner_status(reject_job_id, reject_token);
check(result.success && result.data.preview === null,
	'an explicit preview prompt without metadata returns owner-only null');
global.TEST_PIPE_FLUSH_RESULT = null;
result = invoke('respond_download_preview', {
	job_id: reject_job_id, decision_token: reject_token, accept: false
});
check(result.success && result.data.phase == 'cancelling' &&
	global.TEST_DECISION_WRITES[0] == 'n\n' &&
	global.TEST_TIMERS[3].timeout == 10000,
	'OpenWrt-24 null flush result still delivers one fail-closed rejection line');
emit_download_output(terminal('', -1, 'cancelled'));
end_download_output();
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
result = invoke('get_download_status', { job_id: reject_job_id });
check(result.success && result.data.status == 'cancelled' &&
	result.data.phase == 'cancelled',
	'user rejection is a distinct safe terminal state, not an installation error');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const corrected_metadata_job = result.data.job_id;
const corrected_metadata_token = result.data.decision_token;
emit_download_output(download_progress('es8p_metadata_parse', {
	serviceProviderName: 'Corrected spelling carrier',
	iconType: 'svg',
	icon: b64enc('<svg/>')
}) + download_progress('preview', 'y/n'));
result = owner_status(corrected_metadata_job, corrected_metadata_token);
check(result.success &&
	result.data.preview.serviceProviderName == 'Corrected spelling carrier' &&
	!('icon' in result.data.preview),
	'corrected metadata spelling is accepted while unsafe SVG remains omitted');
invoke('respond_download_preview', {
	job_id: corrected_metadata_job,
	decision_token: corrected_metadata_token,
	accept: false
});
emit_download_output(terminal('', -1, 'cancelled'));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
end_download_output();

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const preview_timeout_job = result.data.job_id;
emit_download_output(download_progress('preview', 'y/n'));
global.TEST_TIMERS[1].callback();
check(length(global.TEST_DECISION_WRITES) == 1 &&
	global.TEST_DECISION_WRITES[0] == 'n\n' &&
	length(global.TEST_SYSTEM_CALLS) == 0 &&
	global.TEST_TIMERS[1].timeout == 10000,
	'preview timeout rejects once and grants bounded cancellation cleanup time');
global.TEST_TIMERS[1].callback();
check(length(global.TEST_SYSTEM_CALLS) == 1,
	'preview cleanup grace expiry kills the complete isolated process group');
const portable_kill = global.TEST_SYSTEM_CALLS[0]?.argv;
same(portable_kill, [ '/bin/kill', '-KILL', '--', '-4321' ],
	'procps process-group kill uses the guarded fixed argv form first');
emit_download_output(terminal('', -1, 'cancelled'));
global.TEST_LAST_PROCESS.output(0);
end_download_output();
result = invoke('get_download_status', { job_id: preview_timeout_job });
check(!result.success && result.error == 'timeout' &&
	result.reason == 'preview_timeout',
	'preview timeout remains explicit and never claims an unknown install outcome');

reset();
global.TEST_SYSTEM_EXITS = [ 1, 0 ];
result = manual_download('smdp.example.com', 'MATCH', '', '');
emit_download_output(download_progress('es10b_prepare_download', 'provider'));
same(map(global.TEST_SYSTEM_CALLS, call => call.argv), [
	[ '/bin/kill', '-KILL', '--', '-4321' ],
	[ '/bin/kill', '-KILL', '-4321' ]
], 'BusyBox process-group kill falls back to its plain fixed argv form');
check(global.TEST_TIMERS[3].timeout == -1,
	'a successful process-group kill does not arm the retry timer');
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
end_download_output();

reset();
global.TEST_SYSTEM_EXITS = [ 1, 1, 0 ];
result = manual_download('smdp.example.com', 'MATCH', '', '');
emit_download_output(download_progress('es10b_prepare_download', 'provider'));
check(length(global.TEST_SYSTEM_CALLS) == 2 &&
	global.TEST_TIMERS[3].timeout == 1000,
	'a failed process-group delivery arms the bounded retry timer');
global.TEST_TIMERS[3].callback();
check(length(global.TEST_SYSTEM_CALLS) == 3 &&
	global.TEST_SYSTEM_CALLS[2].argv[2] == '--',
	'the kill retry short-circuits after a later guarded-form success');
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
end_download_output();

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const bypass_after_preview_timeout_job = result.data.job_id;
emit_download_output(download_progress('preview', 'y/n'));
global.TEST_TIMERS[1].callback();
emit_download_output(download_progress('es10b_prepare_download', 'provider'));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_SUCCESS);
end_download_output();
result = invoke('get_download_status', {
	job_id: bypass_after_preview_timeout_job
});
check(!result.success && result.error == 'timeout' &&
	result.reason == 'outcome_unknown',
	'post-gate activity after a timed-out rejection is classified as uncertain');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const auth_timeout_job = result.data.job_id;
global.TEST_TIMERS[0].callback();
global.TEST_LAST_PROCESS.output(0);
end_download_output();
result = invoke('get_download_status', { job_id: auth_timeout_job });
check(!result.success && result.error == 'timeout' &&
	!('reason' in result),
	'overall timeout before any y decision is safely known to precede installation');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const accepted_timeout_job = result.data.job_id;
const accepted_timeout_token = result.data.decision_token;
emit_download_output(download_progress('preview', 'y/n'));
invoke('respond_download_preview', {
	job_id: accepted_timeout_job,
	decision_token: accepted_timeout_token,
	accept: true
});
global.TEST_TIMERS[0].callback();
global.TEST_LAST_PROCESS.output(0);
end_download_output();
result = invoke('get_download_status', { job_id: accepted_timeout_job });
check(!result.success && result.error == 'timeout' &&
	result.reason == 'outcome_unknown',
	'any timeout after an attempted y requires profile and notification verification');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const bypass_job = result.data.job_id;
emit_download_output(download_progress('es10b_prepare_download', 'provider'));
check(length(global.TEST_SYSTEM_CALLS) == 1,
	'post-gate progress before y triggers an immediate process-group kill');
emit_download_output(terminal({ installed: true }));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_SUCCESS);
end_download_output();
result = invoke('get_download_status', { job_id: bypass_job });
check(!result.success && result.error == 'execution_failed' &&
	result.reason == 'outcome_unknown',
	'a violated mandatory gate is never reported as safely not installed');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const trailing_record_job = result.data.job_id;
emit_download_output(download_progress('preview', 'y/n'));
invoke('respond_download_preview', {
	job_id: trailing_record_job,
	decision_token: result.data.decision_token,
	accept: true
});
emit_download_output(terminal(null) +
	download_progress('es10b_load_bound_profile_package', 'late'));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_SUCCESS);
end_download_output();
result = invoke('get_download_status', { job_id: trailing_record_job });
check(!result.success && result.reason == 'outcome_unknown',
	'a recognized record after terminal success invalidates outcome verification');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const malformed_job = result.data.job_id;
emit_download_output('{"type":"progress",bad}\n');
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
result = invoke('get_download_status', { job_id: malformed_job });
check(result.success && result.data.status == 'running',
	'protocol failure still waits for actual output EOF after leader exit');
end_download_output();
result = invoke('get_download_status', { job_id: malformed_job });
check(!result.success && result.reason == 'preview_protocol_error',
	'malformed NDJSON fails closed without fabricating EOF or outcome uncertainty');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const truncated_job = result.data.job_id;
emit_download_output(substr(download_progress('preview', 'y/n'), 0, 20));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
end_download_output();
result = invoke('get_download_status', { job_id: truncated_job });
check(!result.success && result.reason == 'preview_protocol_error',
	'a non-newline NDJSON tail is rejected as truncated protocol data');

reset();
result = manual_download('smdp.example.com', 'MATCH', '', '');
const oversized_output_job = result.data.job_id;
emit_download_output(make_text('X', 70000));
for (let i = 0; i < 20 && length(global.TEST_OUTPUT_PIPE.buffer); i++)
	global.TEST_TIMERS[2].callback();
check(!length(global.TEST_OUTPUT_PIPE.buffer) &&
	length(global.TEST_SYSTEM_CALLS) >= 1,
	'oversized output is drained in bounded yielded chunks after group kill');
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
result = invoke('get_download_status', { job_id: oversized_output_job });
check(result.success && result.data.status == 'running',
	'oversized output never fabricates EOF after only the leader callback');
end_download_output();
result = invoke('get_download_status', { job_id: oversized_output_job });
check(!result.success && result.reason == 'preview_protocol_error',
	'oversized output reaches a safe terminal state only after real pipe EOF');

reset();
const copied_speedtest =
	'\t\u200b  LPA:1$rsp.truphone.com$QRF-SPEEDTEST\u2060\ufeff\r\n';
result = activation_download(copied_speedtest, '', '');
check(result.success && index(global.TEST_LAST_PROCESS.arguments,
	'LPA:1$rsp.truphone.com$QRF-SPEEDTEST') >= 0,
	'copied Speedtest activation code is normalized only at its boundaries');
const speedtest_job = result.data.job_id;
emit_download_output(download_progress('preview', 'y/n'));
invoke('respond_download_preview', {
	job_id: speedtest_job,
	decision_token: result.data.decision_token,
	accept: false
});
emit_download_output(terminal('', -1, 'cancelled'));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
end_download_output();

reset();
result = activation_download(make_text('A', 4097), '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_PROCESS === null,
	'oversized activation codes are rejected before pipe or process creation');
result = manual_download('smdp.example.com/endpoint', 'MATCH', '', '');
check(!result.success && result.error == 'invalid_argument' &&
	global.TEST_LAST_PROCESS === null,
	'manual server paths cannot inject download arguments');

reset();
global.TEST_PIPE_CLONE_FAIL = true;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'execution_failed' &&
	global.TEST_LAST_PROCESS === null && global.TEST_LOCK_CLOSED,
	'pipe clone failure closes preflight resources before any provider process');
global.TEST_PIPE_CLONE_FAIL = false;
result = manual_download('smdp.example.com', 'RECOVERY', '', '');
check(result.success,
	'pipe setup failure leaves no stale running job or lock');
const recovery_job = result.data.job_id;
emit_download_output(download_progress('preview', 'y/n'));
invoke('respond_download_preview', {
	job_id: recovery_job,
	decision_token: result.data.decision_token,
	accept: false
});
emit_download_output(terminal('', -1, 'cancelled'));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
end_download_output();

reset();
global.TEST_PROCESS_NULL = true;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'execution_failed' &&
	global.TEST_LOCK_CLOSED && global.TEST_PIPE_CLOSE_COUNT >= 6,
	'a null process spawn closes both child and parent pipe resources');

reset();
global.TEST_TIMER_NULL_AT = 3;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'execution_failed' &&
	global.TEST_LAST_PROCESS === null,
	'a missing preallocated drain timer prevents unsafe process creation');

reset();
global.TEST_HANDLE_NULL = true;
result = manual_download('smdp.example.com', 'MATCH', '', '');
check(!result.success && result.error == 'execution_failed' &&
	global.TEST_LAST_PROCESS === null,
	'a missing output watcher prevents a credential-bearing child from spawning');

reset();
global.TEST_HANDLE_NULL_AT = 2;
result = manual_download('smdp.example.com', 'MATCH', '', '');
const rearm_failure_job = result.data.job_id;
emit_download_output(download_progress('preview', 'y/n'));
check(global.TEST_TIMERS[2].timeout == 100 &&
	length(global.TEST_SYSTEM_CALLS) == 1,
	'post-spawn watcher rearm failure retains its reader and schedules safe drain');
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
global.TEST_OUTPUT_PIPE.eof = true;
global.TEST_TIMERS[2].callback();
result = invoke('get_download_status', { job_id: rearm_failure_job });
check(!result.success && result.reason == 'preview_protocol_error',
	'drain retry observes real EOF before finalizing a watcher failure');

reset();
const discovered_event_secret = 'DISCOVERY-EVENT-SECRET';
const discovered_imei = '1234567890123456';
global.TEST_EXEC_REPLY = {
	code: 0,
	stdout: terminal([ {
		eventId: discovered_event_secret,
		rspServerAddress: 'discovered.example.com'
	} ])
};
result = invoke('discover_profiles', {
	smds: 'lpa.ds.gsma.com', imei: discovered_imei
});
const discovered_entry_id = result.data[0].entry_id;
const discovered_expiry_timer = global.TEST_TIMERS[0];
check(result.success && index(sprintf('%J', result), discovered_event_secret) < 0 &&
	index(sprintf('%J', result), discovered_imei) < 0,
	'discovery exposes only an opaque entry ID and safe server display value');

reset();
global.TEST_PROCESS_NULL = true;
result = invoke('download_discovered_profile', {
	entry_id: discovered_entry_id,
	confirmation_code: 'discovery-confirmation-secret'
});
check(!result.success && result.error == 'execution_failed' &&
	index(sprintf('%J', result), discovered_event_secret) < 0,
	'failed discovered-profile spawn returns no hidden event or IMEI');
check(!discovered_expiry_timer.cancelled &&
	length(discovered_expiry_timer.set_calls) == 1 &&
	discovered_expiry_timer.timeout == 300000,
	'a failed spawn restores the claim without extending its original expiry');

reset();
result = invoke('download_discovered_profile', {
	entry_id: discovered_entry_id,
	confirmation_code: 'discovery-confirmation-secret'
});
check(result.success,
	'failed spawn restores the same claimed discovery entry with original expiry');
check(discovered_expiry_timer.cancelled,
	'consuming the final discovery entry cancels its now-unneeded expiry timer');
const discovered_job_id = result.data.job_id;
const discovered_token = result.data.decision_token;
const discovered_argv = global.TEST_LAST_PROCESS.arguments;
const discovered_lpac_index = index(discovered_argv, '/usr/bin/lpac');
same(slice(discovered_argv, discovered_lpac_index), [
	'/usr/bin/lpac', 'profile', 'download', '-p',
	'-s', 'discovered.example.com', '-m', discovered_event_secret,
	'-i', discovered_imei, '-c', 'discovery-confirmation-secret'
], 'discovered download reuses hidden event ID, server, and original IMEI as argv');
check(index(sprintf('%J', result), discovered_event_secret) < 0 &&
	index(sprintf('%J', result), discovered_imei) < 0,
	'discovered start response contains only job ownership state');
emit_download_output(download_progress('preview', 'y/n'));
invoke('respond_download_preview', {
	job_id: discovered_job_id,
	decision_token: discovered_token,
	accept: false
});
emit_download_output(terminal('', -1, 'cancelled'));
global.TEST_LAST_PROCESS.output(DOWNLOAD_EXIT_FAILED);
end_download_output();

reset();
result = invoke('download_discovered_profile', {
	entry_id: discovered_entry_id,
	confirmation_code: ''
});
check(!result.success && result.error == 'entry_unavailable',
	'successfully spawned discovered entry is permanently consumed');

reset();
result = invoke('get_download_status', { job_id: 2147483647 });
check(!result.success && result.error == 'job_not_found',
	'unknown but well-formed download job IDs are rejected');
check(invoke('get_download_status', { job_id: 0 }).success &&
	!invoke('get_download_status', { job_id: -1 }).success &&
	!invoke('get_download_status', { job_id: '1' }).success &&
	!invoke('get_download_status', { job_id: 2147483648 }).success,
	'current-job sentinel is accepted while malformed or out-of-range IDs are rejected');

printf(`1..${checks}\n`);
