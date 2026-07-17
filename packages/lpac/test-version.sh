#!/bin/sh

[ "$1" = "lpac" ] || exit 0

output="$(/usr/bin/lpac --version)" || exit 1
printf '%s\n' "$output" | grep -F '"code":0' >/dev/null || exit 1
printf '%s\n' "$output" | grep -F '"data":"2.3.0"' >/dev/null || exit 1
! printf '%s\n' "$output" | grep -F 'unknown' >/dev/null
