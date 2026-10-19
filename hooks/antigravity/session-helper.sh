#!/bin/bash
set -eu
ADAPTER_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd -P)"
exec node "$ADAPTER_DIR/session-helper.js" "$@"
