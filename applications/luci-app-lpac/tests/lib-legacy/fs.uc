// SPDX-License-Identifier: Apache-2.0

'use strict';

/* Model the fs exports available in OpenWrt 24.10's ucode (no dup2()). */

export function access(path, mode) {
	global.TEST_ACCESS = { path, mode };

	return true;
}

export function lstat(path) {
	if (!global.TEST_LOCK_EXISTS)
		return null;

	return {
		type: 'file',
		uid: 0,
		nlink: 1,
		mode: global.TEST_LOCK_MODE
	};
}

export function open(path, mode, permissions) {
	global.TEST_OPEN = { path, mode, permissions };

	if (!global.TEST_LOCK_EXISTS) {
		global.TEST_LOCK_EXISTS = true;
		global.TEST_LOCK_MODE = permissions;
	}

	return {
		lock: function() {
			return true;
		},

		close: function() {
			global.TEST_LOCK_CLOSE_COUNT++;
			return true;
		}
	};
}

export function chmod(path, mode) {
	global.TEST_LOCK_MODE = mode;
	return true;
}
