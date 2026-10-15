#!/usr/bin/env bash
# Harness test runner: every scripts/tests/*.test.sh, then python unittest for test_*.py (only if any exist:
# Python 3.12+ exits 5 when discovery finds zero tests). Exit 0 only if all pass.
cd "$(dirname "$0")/../.." || exit 1
fail=0
for t in scripts/tests/*.test.sh; do
  [ -e "$t" ] || continue
  out=$(bash "$t" 2>&1) || { echo "FAIL $t"; echo "$out" | tail -5; fail=1; }
done
if ls scripts/tests/test_*.py >/dev/null 2>&1; then
  out=$(python3 -m unittest discover -s scripts/tests -p 'test_*.py' 2>&1) || { echo "FAIL python unittest"; echo "$out" | tail -15; fail=1; }
fi
[ "$fail" -eq 0 ] && echo "harness tests: all passed"
exit $fail
