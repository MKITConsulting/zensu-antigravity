#!/bin/bash
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
exec node --test "$ROOT/tests/host/test-session-adapter.js"
