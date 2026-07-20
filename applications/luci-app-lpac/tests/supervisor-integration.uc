// SPDX-License-Identifier: Apache-2.0

'use strict';

import * as fs from 'fs';
import * as uloop from 'uloop';

/*
 * backend.uc separately asserts that the production supervisor uses this
 * fixed protocol and argv layout. This test executes the same descriptor
 * plumbing with inert children so real fs/uloop/libubox/setsid behavior is
 * covered without an lpac binary, eUICC, activation credential, or network.
 */
const DOWNLOAD_EXIT_SUCCESS = 64;
const DOWNLOAD_EXIT_NOT_FOUND = 65;
const DOWNLOAD_EXIT_NOT_EXECUTABLE = 66;
const DOWNLOAD_EXIT_FAILED = 67;
const DOWNLOAD_EXIT_SIGNALED = 68;
const DOWNLOAD_EXIT_PIPE_FAILED = 69;
const DOWNLOAD_SCRIPT = 'exec 2>/dev/null\n' +
	'case "$1:$2" in *[!0-9:]*) exit 69;; :*|*:) exit 69;; esac\n' +
	'in_fd=$1\n' +
	'out_fd=$2\n' +
	'shift 2\n' +
	'exec 0<"/proc/self/fd/$in_fd" 1>"/proc/self/fd/$out_fd" || exit 69\n' +
	'"$@"\n' +
	'code=$?\n' +
	`[ "$code" -eq 0 ] && exit ${DOWNLOAD_EXIT_SUCCESS}\n` +
	`[ "$code" -eq 127 ] && exit ${DOWNLOAD_EXIT_NOT_FOUND}\n` +
	`[ "$code" -eq 126 ] && exit ${DOWNLOAD_EXIT_NOT_EXECUTABLE}\n` +
	`[ "$code" -ge 128 ] && [ "$code" -lt 255 ] && exit ${DOWNLOAD_EXIT_SIGNALED}\n` +
	`exit ${DOWNLOAD_EXIT_FAILED}`;
const PROCESS_ENV = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' };
const FAKE_INTERACTIVE_SCRIPT =
	'printf "%s\\n" \'{"type":"progress","payload":{"code":0,"message":"es8p_meatadata_parse","data":{"iccid":"8944000000000000001","serviceProviderName":"Test Provider","profileName":"Test Profile","profileClass":"operational"}}}\'\n' +
	'printf %s \'{"type":"progress","payload":{"code":0,"message":"pre\'\n' +
	'sleep 0.05\n' +
	'printf "%s\\n" \'view","data":"y/n"}}\'\n' +
	'IFS= read -r answer || answer=eof\n' +
	'printf \'{"type":"decision","answer":"%s"}\\n\' "$answer"\n' +
	'if [ "$answer" = y ]; then\n' +
	'  printf "%s\\n" \'{"type":"progress","payload":{"code":0,"message":"es10b_prepare_download","data":null}}\'\n' +
	'  printf "%s\\n" \'{"type":"lpa","payload":{"code":0,"message":"success","data":null}}\'\n' +
	'else\n' +
	'  printf "%s\\n" \'{"type":"lpa","payload":{"code":-1,"message":"cancelled","data":null}}\'\n' +
	'fi';

let failures = 0;

function check(condition, message) {
	if (condition)
		printf(`ok - ${message}\n`);
	else {
		warn(`not ok - ${message}\n`);
		failures++;
	}
}

function finish(exit_message) {
	if (failures > 0)
		die(`${exit_message}: ${failures} failure(s)\n`);

	printf(`${exit_message}: all checks passed\n`);
}

function run_protocol(setsid_path, shell_path) {
	const cases = [
		{
			name: 'a successful child is translated to reserved status 64',
			arguments: [ shell_path, '-c', 'exit 0' ],
			expected: DOWNLOAD_EXIT_SUCCESS
		},
		{
			name: 'a missing child is translated to reserved status 65',
			arguments: [ '/luci-lpac-test/does-not-exist' ],
			expected: DOWNLOAD_EXIT_NOT_FOUND
		},
		{
			name: 'a non-executable child is translated to reserved status 66',
			arguments: [ '/etc/passwd' ],
			expected: DOWNLOAD_EXIT_NOT_EXECUTABLE
		},
		{
			name: 'an ordinary child failure is translated to reserved status 67',
			arguments: [ shell_path, '-c', 'exit 23' ],
			expected: DOWNLOAD_EXIT_FAILED
		},
		{
			name: 'a signalled child is translated to reserved status 68',
			arguments: [ shell_path, '-c', 'kill -TERM "$$"' ],
			expected: DOWNLOAD_EXIT_SIGNALED
		},
		{
			name: 'invalid communication descriptors use reserved status 69',
			arguments: [],
			expected: DOWNLOAD_EXIT_PIPE_FAILED,
			invalid_descriptors: true
		}
	];
	const processes = [];
	let pending = length(cases);

	function completed() {
		pending--;

		if (pending == 0)
			uloop.end();
	}

	function launch(testcase) {
		let arguments;
		let input = null;
		let output = null;
		let parent_input = null;
		let parent_output = null;

		if (testcase.invalid_descriptors) {
			arguments = [
				shell_path, '-c', DOWNLOAD_SCRIPT,
				'luci-lpac-supervisor-test', '', 'not-a-descriptor'
			];
		}
		else {
			input = fs.pipe();
			output = fs.pipe();

			if (!input || !output) {
				check(false, `real pipes were created for: ${testcase.name}`);
				completed();
				return;
			}

			const input_fd = input[0].fileno();
			const output_fd = output[1].fileno();

			parent_input = fs.open(`/proc/self/fd/${input[1].fileno()}`, 'we');
			parent_output = fs.open(`/proc/self/fd/${output[0].fileno()}`, 're');

			input[1].close();
			output[0].close();

			if (!parent_input || !parent_output) {
				check(false, `CLOEXEC parent pipe ends were created for: ${testcase.name}`);
				input[0].close();
				output[1].close();
				parent_input?.close();
				parent_output?.close();
				completed();
				return;
			}

			arguments = [
				shell_path, '-c', DOWNLOAD_SCRIPT,
				'luci-lpac-supervisor-test', `${input_fd}`, `${output_fd}`
			];
		}

		for (let argument in testcase.arguments)
			push(arguments, argument);

		const child = uloop.process(setsid_path, arguments, PROCESS_ENV,
			function(exit_code) {
				check(exit_code == testcase.expected, testcase.name);
				completed();
			});

		if (child)
			push(processes, child);
		else {
			check(false, `uloop.process() started the case: ${testcase.name}`);
			completed();
		}

		if (!testcase.invalid_descriptors) {
			/* Child ends were inherited at fork; the parent drops every copy. */
			input[0].close();
			output[1].close();
			parent_input.close();
			parent_output.close();
		}
	}

	for (let testcase in cases)
		launch(testcase);

	const watchdog = uloop.timer(5000, function() {
		check(false, 'all exit-protocol callbacks arrived within five seconds');
		uloop.end();
	});

	const run_result = uloop.run();

	watchdog.cancel();
	check(run_result == 0, 'the uloop event loop completed normally');
	check(pending == 0 && length(processes) == length(cases),
		'uloop.process() invoked every exit-protocol callback');
	finish('uloop exit protocol');
}

function run_interactive_pipe(setsid_path, shell_path, accept) {
	/* Force child pipe descriptors beyond dash's single-digit redirection range. */
	const filler = [];

	for (let i = 0; i < 16; i++) {
		const file = fs.open('/dev/null', 're');

		if (file)
			push(filler, file);
	}

	const input = fs.pipe();
	const output = fs.pipe();

	if (!input || !output)
		die(`unable to create interactive test pipes: ${fs.error()}\n`);

	const child_input_fd = input[0].fileno();
	const child_output_fd = output[1].fileno();
	const parent_input_fd = input[1].fileno();
	const parent_output_fd = output[0].fileno();
	let parent_input = fs.open(`/proc/self/fd/${parent_input_fd}`, 'we');
	let parent_output = fs.open(`/proc/self/fd/${parent_output_fd}`, 're');

	check(child_input_fd > 9 && child_output_fd > 9,
		'interactive child descriptors are both greater than nine');
	check(parent_input !== null && parent_output !== null,
		'parent pipe ends were reopened with close-on-exec');

	if (!parent_input || !parent_output)
		die(`unable to clone interactive test pipes: ${fs.error()}\n`);

	input[1].close();
	output[0].close();

	let process_exited = false;
	let output_eof = false;
	let exit_code = null;
	let collected = '';
	let read_callbacks = 0;
	let decision_writes = 0;
	let decision_write_ok = null;
	let output_watch = null;
	let watchdog = null;

	function maybe_complete() {
		if (process_exited && output_eof)
			uloop.end();
	}

	const process_handle = uloop.process(setsid_path, [
		shell_path, '-c', DOWNLOAD_SCRIPT, 'luci-lpac-interactive-test',
		`${child_input_fd}`, `${child_output_fd}`,
		shell_path, '-c', FAKE_INTERACTIVE_SCRIPT, 'fake-lpac'
	], PROCESS_ENV, function(code) {
		process_exited = true;
		exit_code = code;
		maybe_complete();
	});

	check(process_handle !== null,
		'interactive wrapper started in an isolated process group');

	input[0].close();
	output[1].close();

	for (let file in filler)
		file.close();

	if (!process_handle)
		die(`unable to start interactive test wrapper: ${uloop.error()}\n`);

	let output_ready;

	function register_output_watch() {
		output_watch = uloop.handle(parent_output, output_ready, uloop.ULOOP_READ);

		if (!output_watch)
			die(`unable to watch interactive output: ${uloop.error()}\n`);
	}

	function reopen_output() {
		const old_output = parent_output;
		const old_fd = old_output.fileno();
		const replacement = fs.open(`/proc/self/fd/${old_fd}`, 're');

		if (!replacement)
			die(`unable to rearm interactive output: ${fs.error()}\n`);

		output_watch.delete();
		old_output.close();
		parent_output = replacement;
		register_output_watch();
	}

	output_ready = function() {
		read_callbacks++;

		for (let i = 0; i < 8192; i++) {
			const byte = parent_output.read(1);

			if (byte === null) {
				reopen_output();
				return;
			}

			if (type(byte) != 'string' || !length(byte)) {
				output_watch.delete();
				output_watch = null;
				parent_output.close();
				parent_output = null;
				output_eof = true;
				maybe_complete();
				return;
			}

			collected += byte;

			if (parent_input !== null &&
			    index(collected, '"message":"preview"') >= 0) {
				if (accept) {
					decision_writes++;
					decision_write_ok = parent_input.write('y\n') == 2;

					/* OpenWrt 24 may return null for a successful flush. */
					try { parent_input.flush(); }
					catch (e) { /* close below is the final best effort. */ }
			}

				parent_input.close();
				parent_input = null;
			}
		}
	};

	register_output_watch();
	watchdog = uloop.timer(5000, function() {
		check(false, 'interactive pipe reached process callback and real EOF');
		uloop.end();
	});

	const run_result = uloop.run();

	watchdog.cancel();
	output_watch?.delete();
	parent_input?.close();
	parent_output?.close();

	check(run_result == 0, 'interactive uloop event loop completed normally');
	check(process_exited && output_eof,
		'interactive completion waited for both process exit and output EOF');
	check(exit_code == DOWNLOAD_EXIT_SUCCESS,
		'interactive inert child success uses reserved wrapper status 64');
	check(read_callbacks >= 2,
		'fragmented NDJSON required multiple nonblocking output callbacks');
	check(index(collected, '"message":"preview"') >= 0,
		'fragmented preview JSON was reconstructed without lost bytes');
	check(index(collected, '"serviceProviderName":"Test Provider"') >= 0,
		'preview metadata traversed the real output pipe intact');

	if (accept) {
		check(decision_writes == 1 && decision_write_ok === true,
			'exactly one acceptance line was written to the child');
		check(index(collected, '"answer":"y"') >= 0,
			'the inert child received the acceptance decision');
		check(index(collected, '"message":"es10b_prepare_download"') >= 0 &&
		      index(collected, '"message":"success"') >= 0,
			'acceptance allowed the inert post-gate and terminal records');
	}
	else {
		check(decision_writes == 0,
			'EOF cancellation did not write an installation decision');
		check(index(collected, '"answer":"eof"') >= 0,
			'the child observed EOF after the last parent writer closed');
		check(index(collected, '"message":"cancelled"') >= 0 &&
		      index(collected, 'es10b_prepare_download') < 0,
			'EOF cancellation never crossed the inert installation gate');
	}

	finish(accept ? 'interactive preview acceptance' : 'interactive preview EOF');
}

function run_raw_group_signal(setsid_path, shell_path, kill_path, pid_file) {
	const group_script =
		'pid_file=$1\n' +
		'shell=$2\n' +
		'pgid=$(ps -o pgid= -p "$$")\n' +
		'[ "$pgid" -eq "$$" ] || exit 41\n' +
		'"$shell" -c \'trap "" HUP TERM; while :; do sleep 30; done\' &\n' +
		'child=$!\n' +
		'child_pgid=$(ps -o pgid= -p "$child")\n' +
		'[ "$child_pgid" -eq "$$" ] || exit 42\n' +
		'printf "%s %s\\n" "$$" "$child" > "$pid_file"\n' +
		'wait "$child"';
	let callback_code = null;
	let kill_sent = false;
	let polls = 0;
	let process_handle = null;

	process_handle = uloop.process(setsid_path, [
		shell_path, '-c', group_script, 'luci-lpac-group-test', pid_file,
		shell_path
	], PROCESS_ENV, function(exit_code) {
		callback_code = exit_code;
		check(kill_sent, 'the isolated supervisor remained alive until the watchdog fired');
		check(exit_code == 0,
			'a SIGKILLed supervisor is reported as raw zero by uloop.process()');
		uloop.end();
	});

	check(process_handle !== null, 'uloop.process() started the isolated process group');

	if (!process_handle)
		finish('uloop process-group signal');

	const process_pid = process_handle.pid();
	let poll_timer = null;

	poll_timer = uloop.timer(10, function() {
		const ready = system([
			shell_path, '-c', '[ -s "$1" ]', 'luci-lpac-pid-check', pid_file
		]);

		if (ready == 0) {
			kill_sent = true;
			let delivered = false;

			try {
				delivered = system([
					kill_path, '-KILL', '--', `-${process_pid}`
				]) == 0;
			}
			catch (e) {
				/* Try the BusyBox-compatible form below. */
			}

			if (!delivered) {
				try {
					delivered = system([
						kill_path, '-KILL', `-${process_pid}`
					]) == 0;
				}
				catch (e) {
					/* The assertion below reports delivery failure. */
				}
			}

			check(delivered,
				'the watchdog can signal the setsid process group by uloop PID');
		}
		else if (++polls < 200)
			poll_timer.set(10);
		else {
			check(false, 'the isolated process group published its PIDs');
			uloop.end();
		}
	});

	const watchdog = uloop.timer(5000, function() {
		check(false, 'the process-group signal callback arrived within five seconds');
		uloop.end();
	});

	const run_result = uloop.run();

	poll_timer.cancel();
	watchdog.cancel();
	check(run_result == 0, 'the process-group uloop event loop completed normally');
	check(callback_code !== null, 'the killed supervisor invoked its process callback');
	finish('uloop process-group signal');
}

function run_lock_descendant(setsid_path, shell_path, lock_file, pid_file) {
	const descendant_script =
		'pid_file=$1\n' +
		'shell=$2\n' +
		'pgid=$(ps -o pgid= -p "$$")\n' +
		'[ "$pgid" -eq "$$" ] || exit 51\n' +
		'"$shell" -c \'trap "" HUP TERM; while :; do sleep 30; done\' &\n' +
		'child=$!\n' +
		'child_pgid=$(ps -o pgid= -p "$child")\n' +
		'[ "$child_pgid" -eq "$$" ] || exit 52\n' +
		'printf "%s %s\\n" "$$" "$child" > "$pid_file"\n' +
		'exit 0';
	let callback_code = null;
	const lock_handle = fs.open(lock_file, 'a', 0o600);

	check(lock_handle !== null, 'fs.open() created the synthetic operation lock');
	check(lock_handle?.lock('xn') === true,
		'fs.file.lock() acquired an exclusive nonblocking flock');

	if (!lock_handle)
		finish('uloop inherited lock');

	const process_handle = uloop.process(setsid_path, [
		shell_path, '-c', descendant_script, 'luci-lpac-lock-test', pid_file,
		shell_path
	], PROCESS_ENV, function(exit_code) {
		callback_code = exit_code;
		uloop.end();
	});

	check(process_handle !== null,
		'uloop.process() started a supervisor with a surviving descendant');
	check(lock_handle.close() === true,
		'the ucode parent released its own lock descriptor after process creation');

	if (!process_handle)
		finish('uloop inherited lock');

	const watchdog = uloop.timer(5000, function() {
		check(false, 'the lock-inheritance callback arrived within five seconds');
		uloop.end();
	});

	const run_result = uloop.run();

	watchdog.cancel();
	check(run_result == 0, 'the lock-inheritance uloop event loop completed normally');
	check(callback_code == 0,
		'the supervisor exited normally after launching its descendant');
	finish('uloop inherited lock');
}

if (length(ARGV) < 3)
	die('usage: supervisor-integration.uc MODE SETSID SHELL [MODE_ARGS...]\n');

const mode = ARGV[0];
const setsid_path = ARGV[1];
const shell_path = ARGV[2];

if (!uloop.init())
	die(`unable to initialize uloop: ${uloop.error()}\n`);

if (mode == 'protocol')
	run_protocol(setsid_path, shell_path);
else if (mode == 'pipe-accept' && length(ARGV) == 3)
	run_interactive_pipe(setsid_path, shell_path, true);
else if (mode == 'pipe-eof' && length(ARGV) == 3)
	run_interactive_pipe(setsid_path, shell_path, false);
else if (mode == 'raw-group' && length(ARGV) == 5)
	run_raw_group_signal(setsid_path, shell_path, ARGV[3], ARGV[4]);
else if (mode == 'lock-descendant' && length(ARGV) == 5)
	run_lock_descendant(setsid_path, shell_path, ARGV[3], ARGV[4]);
else
	die(`invalid supervisor integration mode or arguments: ${mode}\n`);
