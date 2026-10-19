#!/bin/bash
# Compatibility entry point for callers of the former lazy initializer.
# Session identity comes only from the normalized host payload. Never write a
# project-wide current-session pointer or derive a session from a process id.
set -eu
ADAPTER_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd -P)"
exec node "$ADAPTER_DIR/session-bootstrap.js" --event "${1:-PreInvocation}"
