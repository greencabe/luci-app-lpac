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

global.TEST_UCI = default_config();
global.TEST_UCI_LOAD_FAIL = false;
global.TEST_COMMIT_OK = true;
global.TEST_LOCK_EXISTS = false;
global.TEST_LOCK_MODE = 0o600;
global.TEST_LOCK_CLOSE_COUNT = 0;
global.TEST_TASK_THROW = false;
global.TEST_TASK_NULL = false;
global.TEST_TASK_FINISHED_THROW = false;
global.TEST_TASKS = [];
global.TEST_LAST_TASK = null;
global.TEST_EXEC_STATUS = 0;
global.TEST_EXEC_REPLY = null;
global.TEST_DEFER_THROW = false;
global.TEST_DEFER_NULL = false;
global.TEST_SYSTEM_EXIT = 0;
global.TEST_SYSTEM_CALL = null;
global.system = function(argv, timeout) {
	global.TEST_SYSTEM_CALL = { argv, timeout };
	return global.TEST_SYSTEM_EXIT;
};

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

const plugin = loadfile('./root/usr/share/rpcd/ucode/luci.lpac', {
	module_search_path: [
		'../../../../../tests/lib-legacy/*.uc',
		'../../../../../tests/lib/*.uc'
	]
})();
const methods = plugin['luci.lpac'];

function invoke(name, args) {
	const request = { args: args || {} };

	return methods[name].call(request);
}

const shell_secret = 'quote\'";$(HARmless)-secret';
let result = invoke('download_profile', {
	mode: 'manual',
	activation_code: '',
	smdp: 'smdp.example.com',
	matching_id: 'MATCH-ID',
	imei: '123456789012345',
	confirmation_code: shell_secret
});

check(result.success && result.data.status == 'running',
	'legacy ucode starts the asynchronous download job without fs.dup2');
const job_id = result.data.job_id;
const worker_result = global.TEST_LAST_TASK.worker();

global.TEST_LAST_TASK.finished = true;
global.TEST_LAST_TASK.output(worker_result);

same(global.TEST_SYSTEM_CALL.argv, [
	'/bin/sh', '-c', 'exec "$@" >/dev/null 2>&1', 'luci-lpac-download',
	'/usr/bin/lpac', 'profile', 'download',
	'-s', 'smdp.example.com', '-m', 'MATCH-ID',
	'-i', '123456789012345', '-c', shell_secret
], 'legacy fallback uses one fixed script and keeps every browser value positional');
check(global.TEST_SYSTEM_CALL.argv[2] == 'exec "$@" >/dev/null 2>&1' &&
	index(global.TEST_SYSTEM_CALL.argv[2], shell_secret) < 0 &&
	global.TEST_SYSTEM_CALL.timeout == 600000,
	'shell metacharacters never enter the fixed legacy script');
result = invoke('get_download_status', { job_id });
check(result.success && result.data.status == 'success' &&
	index(sprintf('%J', result), shell_secret) < 0 &&
	global.TEST_LOCK_CLOSE_COUNT == 2,
	'legacy completion is redacted and releases both lock copies');

printf(`1..${checks}\n`);
