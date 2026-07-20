#!/bin/sh
# SPDX-License-Identifier: Apache-2.0

set -eu

UCODE_BIN=${UCODE_BIN:-ucode}
UCODE_MODULE_DIR=${UCODE_MODULE_DIR:-}
UCODE_RUNTIME_LIB_DIR=${UCODE_RUNTIME_LIB_DIR:-}
SETSID_PATH=${SETSID_PATH:-/usr/bin/setsid}
FLOCK_PATH=${FLOCK_PATH:-/usr/bin/flock}
SHELL_PATH=${SHELL_PATH:-/bin/sh}
KILL_PATH=${KILL_PATH:-/bin/kill}

test_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
ucode_test=${test_dir}/supervisor-integration.uc
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/luci-lpac-supervisor.XXXXXX")
raw_pid_file=${work_dir}/raw-group.pids
lock_pid_file=${work_dir}/lock-group.pids
lock_file=${work_dir}/operation.lock

valid_pid() {
	case $1 in
		''|*[!0-9]*) return 1 ;;
		*) [ "$1" -gt 1 ] ;;
	esac
}

kill_group() {
	group=$1

	"$KILL_PATH" -KILL -- "-$group" 2>/dev/null && return 0
	"$KILL_PATH" -KILL "-$group" 2>/dev/null
}

cleanup_group() {
	pid_file=$1

	[ -s "$pid_file" ] || return 0
	read -r leader _child < "$pid_file" || return 0
	valid_pid "$leader" || return 0
	kill_group "$leader" || true
}

cleanup() {
	cleanup_group "$raw_pid_file"
	cleanup_group "$lock_pid_file"
	rm -rf "$work_dir"
}

trap cleanup EXIT HUP INT TERM

for executable in "$UCODE_BIN" "$SETSID_PATH" "$FLOCK_PATH" \
	"$SHELL_PATH" "$KILL_PATH"; do
	if [ ! -x "$executable" ]; then
		echo "Required executable is unavailable: $executable" >&2
		exit 1
	fi
done

if [ -z "$UCODE_MODULE_DIR" ] || [ ! -r "$UCODE_MODULE_DIR/uloop.so" ] ||
	[ ! -r "$UCODE_MODULE_DIR/fs.so" ]; then
	echo 'UCODE_MODULE_DIR must contain the real fs.so and uloop.so modules' >&2
	exit 1
fi

if [ -n "$UCODE_RUNTIME_LIB_DIR" ]; then
	LD_LIBRARY_PATH=${UCODE_RUNTIME_LIB_DIR}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}
	export LD_LIBRARY_PATH
fi

run_ucode() {
	"$UCODE_BIN" -S -L "$UCODE_MODULE_DIR" "$ucode_test" "$@"
}

group_has_live_process() {
	group=$1

	ps -eo pgid=,stat= | awk -v group="$group" '
		$1 == group && $2 !~ /^Z/ { found = 1 }
		END { exit(found ? 0 : 1) }
	'
}

wait_for_group_exit() {
	group=$1
	attempt=0

	while group_has_live_process "$group"; do
		attempt=$((attempt + 1))

		if [ "$attempt" -ge 100 ]; then
			echo "Process group $group still has live members" >&2
			return 1
		fi

		sleep 0.05
	done
}

read_group() {
	pid_file=$1

	if ! read -r leader child < "$pid_file" ||
		! valid_pid "$leader" || ! valid_pid "$child" ||
		[ "$leader" -eq "$child" ]; then
		echo "Invalid process-group record in $pid_file" >&2
		exit 1
	fi
}

try_lock() {
	"$FLOCK_PATH" -n "$lock_file" "$SHELL_PATH" -c 'exit 0'
}

echo 'Testing real uloop.process() callbacks and reserved exit protocol'
run_ucode protocol "$SETSID_PATH" "$SHELL_PATH"

echo 'Testing fragmented interactive preview acceptance over high file descriptors'
run_ucode pipe-accept "$SETSID_PATH" "$SHELL_PATH"

echo 'Testing fail-closed interactive preview cancellation on input EOF'
run_ucode pipe-eof "$SETSID_PATH" "$SHELL_PATH"

echo 'Testing setsid process-group timeout kill and raw-zero callback behavior'
run_ucode raw-group "$SETSID_PATH" "$SHELL_PATH" "$KILL_PATH" "$raw_pid_file"
read_group "$raw_pid_file"
raw_leader=$leader
wait_for_group_exit "$raw_leader"

echo 'Testing fs.file flock lifetime through uloop process descendants'
run_ucode lock-descendant "$SETSID_PATH" "$SHELL_PATH" \
	"$lock_file" "$lock_pid_file"
read_group "$lock_pid_file"
lock_leader=$leader

if try_lock; then
	echo 'The inherited lock was released while a descendant was still alive' >&2
	exit 1
fi

kill_group "$lock_leader"
wait_for_group_exit "$lock_leader"

attempt=0
until try_lock; do
	attempt=$((attempt + 1))

	if [ "$attempt" -ge 100 ]; then
		echo 'The inherited lock was not released after the process group exited' >&2
		exit 1
	fi

	sleep 0.05
done

echo 'Supervisor integration tests passed'
