// SPDX-License-Identifier: Apache-2.0

export function access(path, mode) {
	global.TEST_ACCESS = { path, mode };

	return global.TEST_LPAC_ACCESS;
}

export function lstat(path) {
	global.TEST_LSTAT_PATH = path;

	if (!global.TEST_LOCK_EXISTS)
		return null;

	return {
		type: global.TEST_LOCK_TYPE,
		uid: global.TEST_LOCK_UID,
		nlink: global.TEST_LOCK_NLINK,
		mode: global.TEST_LOCK_MODE
	};
}

export function open(path, mode, permissions) {
	global.TEST_OPEN = { path, mode, permissions };

	if (path == '/dev/null') {
		push(global.TEST_REDIRECT_EVENTS, `open:${path}:${mode}`);
		global.TEST_DEVNULL_OPEN = { path, mode, permissions };

		if (global.TEST_DEVNULL_OPEN_FAIL)
			return null;

		return {
			fileno: function() {
				push(global.TEST_REDIRECT_EVENTS,
					`fileno:${global.TEST_DEVNULL_FD}`);

				return global.TEST_DEVNULL_FILENO_FAIL
					? null : global.TEST_DEVNULL_FD;
			},

			close: function() {
				push(global.TEST_REDIRECT_EVENTS,
					`close:${global.TEST_DEVNULL_FD}`);
				global.TEST_DEVNULL_CLOSE_ATTEMPTS++;

				if (global.TEST_DEVNULL_CLOSE_FAIL)
					return null;

				global.TEST_DEVNULL_CLOSED = true;
				return true;
			}
		};
	}

	if (global.TEST_LOCK_OPEN_FAIL)
		return null;

	if (!global.TEST_LOCK_EXISTS) {
		global.TEST_LOCK_EXISTS = true;
		global.TEST_LOCK_MODE = permissions;
	}

	return {
		lock: function(flags) {
			global.TEST_LOCK_FLAGS = flags;
			return !global.TEST_LOCK_BUSY;
		},

		close: function() {
			global.TEST_LOCK_CLOSED = true;
			global.TEST_LOCK_CLOSE_COUNT++;
			return true;
		}
	};
}

export function dup2(oldfd, newfd) {
	push(global.TEST_REDIRECT_EVENTS, `dup2:${oldfd}:${newfd}`);

	return global.TEST_DUP2_FAIL_TARGET === newfd ? null : true;
}

export function chmod(path, mode) {
	global.TEST_CHMOD = { path, mode };

	if (global.TEST_LOCK_CHMOD_FAIL)
		return null;

	global.TEST_LOCK_MODE = mode;
	return true;
}
