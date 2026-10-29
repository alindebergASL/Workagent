"""Supplied smoke tests. Execute only inside the authorized worker."""
import copy
import importlib.util
import json
from pathlib import Path
import sys


def main():
    mode = sys.argv[1]
    defaults = {"v1": "bands_v1.py", "v2": "bands_v2.py", "transfer": "transfer.py"}
    path = Path(sys.argv[2] if len(sys.argv) > 2 else defaults[mode]).resolve()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    spec = importlib.util.spec_from_file_location("candidate", path)
    assert spec is not None and spec.loader is not None, "candidate must be Python source"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fn = getattr(module, "free_ticks" if mode == "transfer" else "blocked_ticks")
    if mode == "v1":
        cases = [([], 10, []), ([{"start": "2", "stop": "5"}], 10, [(2, 5)]),
                 ([{"start": "8", "stop": "13"}], 10, [(0, 3), (8, 10)]),
                 ([{"start": "3", "stop": "13"}], 10, [(0, 10)])]
    elif mode == "v2":
        cases = [([], 10, []), ([{"anchor": "3", "span": "2"}], 10, [(3, 5)]),
                 ([{"anchor": "8", "span": "5"}], 10, [(0, 3), (8, 10)]),
                 ([{"status": "maintenance-bypass"}], 10, [])]
    else:
        cases = [([], 9, [(0, 9)]), ([{"at": 4, "width": 1}], 9, [(0, 4), (5, 9)]),
                 ([{"at": 7, "width": 4}], 9, [(2, 7)]),
                 ([{"at": 3, "width": 9}], 9, [])]
    failures = []
    for i, (rows, size, expected) in enumerate(cases):
        original = copy.deepcopy(rows)
        try:
            result = fn(iter(rows), size)
            assert result == expected, (result, expected)
            assert rows == original, "input mutation"
        except Exception as exc:
            failures.append({"case": i, "error": type(exc).__name__, "detail": str(exc)})
    print(json.dumps({"stage": mode, "total": len(cases), "passed": len(cases)-len(failures),
                      "verdict": "FAIL" if failures else "PASS", "failures": failures}))
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
