#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm --prefix web test
node --test server/*.test.mjs lab/*.test.mjs
(cd lab && python3 -m unittest test_capacity.py)
