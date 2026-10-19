"""Compare complete Python result objects with the canonical JS algorithm locally.

Usage: python3 compare_parity.py /absolute/path/to/templates/workflows/zensu-review-v1.js
"""
import json
import pathlib
import subprocess
import sys
from test_python_workflow import Runtime, finding, packet

source = pathlib.Path(sys.argv[1]).resolve(strict=True)
runner = pathlib.Path(__file__).with_name("run_canonical_fixture.cjs")
cases = [
    (packet(), {}),
    (packet(), {"find:correctness": {"findings": [finding()]}}),
    (packet(), {"find:correctness": "$FAIL", "find:security": {"findings": [finding()]}}),
    (packet(), {"find:correctness": {"findings": [finding(), {"severity": "MAJOR"}]}, "refute:correctness#1": "$FAIL"}),
    (packet(), {"find:correctness": {"findings": [finding()]}, "refute:correctness#1": {"outcome": "not-real", "severity": "SUGGESTION", "reasoning": "Already guarded"}}),
    (packet(), {"find:correctness": {"findings": [finding()]}, "refute:correctness#1": {}}),
    (packet(), {"find:correctness": {"findings": [finding(confidence=82)]}, "find:security": {"findings": [finding(line=15, severity="IMPORTANT", confidence=99)]}}),
    (packet(ceiling=2, perLensCap=1), {"find:correctness": {"findings": [finding(line=1), finding("Another issue", "IMPORTANT", line=20), finding("Tiny polish", "SUGGESTION", line=40)]}}),
    (packet(perLensCap=1), {"find:correctness": {"findings": [finding("Separate critical defect", line=1), finding("Shared permission failure", line=60)]}, "find:security": {"findings": [finding("Shared permission failure", "IMPORTANT", line=61)]}}),
    (packet(), {"find:correctness": {"findings": [finding(title="😀" * 160, file="./src\\app.py", evidence="\ufeff " + "😀" * 2100, line=True, confidence=True)]}}),
]
for index, (args, responses) in enumerate(cases, 1):
    fixture = {"args": args, "responses": responses}
    result = subprocess.run(["node", str(runner), str(source)], input=json.dumps(fixture), text=True, capture_output=True, check=True)
    expected = json.loads(result.stdout)
    converted = {key: RuntimeError("fixture failure") if value == "$FAIL" else value for key, value in responses.items()}
    runtime = Runtime({key: value for key, value in converted.items() if key.startswith("find:")},
                      {key: value for key, value in converted.items() if key.startswith("refute:")})
    actual = runtime.run(args)
    if actual != expected:
        raise AssertionError("Canonical parity mismatch in case %s:\nPython: %s\nSource: %s" % (index, json.dumps(actual), json.dumps(expected)))
print("PASS: %s complete result fixtures match the canonical JS template exactly" % len(cases))
