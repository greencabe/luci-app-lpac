// SPDX-License-Identifier: Apache-2.0

'use strict';

export function task(worker, output) {
	if (global.TEST_TASK_THROW)
		die('task failed');

	if (global.TEST_TASK_NULL)
		return null;

	const state = {
		worker,
		output,
		finished: false
	};

	global.TEST_LAST_TASK = state;
	push(global.TEST_TASKS, state);

	return {
		finished: function() {
			if (global.TEST_TASK_FINISHED_THROW)
				die('finished failed');

			return state.finished;
		}
	};
}
