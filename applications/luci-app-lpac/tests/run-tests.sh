#!/bin/sh
# SPDX-License-Identifier: Apache-2.0

set -eu

cd "$(dirname "$0")/.."
ucode -S -L ./tests/lib ./tests/backend.uc
ucode -S -L ./tests/lib ./tests/backend-legacy.uc
