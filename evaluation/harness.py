"""Offline held-out custody/transport harness. This module has NO live provider mode.

Evaluator root must be outside the repository. Only frozen allowlisted episode
inputs cross into a no-network OS namespace. Neither oracles nor this controller
are mounted. The product's actual request builder runs there; SQLite continuity
is harness state, NOT proof of PostgreSQL application lifecycle or model quality.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

REPO = Path(__file__).resolve().parents[1]
BASELINE = "26e599b3db8a61b73eeeaea4f87a1d3de0b296d9"
VARIANTS = ("B0", "B1", "M1")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def write_new(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data)


def external_root(path: Path) -> Path:
    path = path.resolve(strict=True)
    if not path.is_dir() or path == REPO or REPO in path.parents or path in REPO.parents:
        raise ValueError("evaluator_root_must_be_disjoint_from_repository")
    if path.stat().st_mode & 0o077:
        raise ValueError("evaluator_root_requires_mode_0700")
    return path


def safe_file(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]+", name):
        raise ValueError("unsafe_input_name")
    p = root / name
    if p.is_symlink() or not p.is_file() or p.resolve().parent != root.resolve() or p.stat().st_nlink != 1:
        raise ValueError("nonregular_or_linked_input")
    if p.stat().st_size > 1024 * 1024:
        raise ValueError("oversized_input")
    return p


def files_manifest(root: Path):
    rows = []
    for p in sorted(root.rglob("*")):
        if p.is_symlink():
            raise ValueError("symlink_in_manifest")
        if p.is_file():
            rows.append({"path": str(p.relative_to(root)), "bytes": p.stat().st_size,
                         "sha256": digest(p.read_bytes())})
    return rows


def source_manifest(root: Path):
    return [{"path": r["path"], "sha256": r["sha256"]} for r in files_manifest(root)
            if "__pycache__" not in r["path"] and not r["path"].endswith(".pyc")]


def load_study(root: Path):
    manifest_bytes = (root / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    freeze = json.loads((root / "freeze.json").read_bytes())
    if digest(manifest_bytes) != freeze["manifest_sha256"]:
        raise ValueError("manifest_changed_after_freeze")
    for area in ("fixtures", "oracles", "trajectories", "scoring"):
        if files_manifest(root / area) != freeze[area]:
            raise ValueError("frozen_material_changed:" + area)
    if manifest["baseline"] != BASELINE or manifest["variants"] != list(VARIANTS):
        raise ValueError("invalid_comparison")
    return manifest


def stage_episode(root: Path, spec: dict, target: Path, forbidden: list[bytes]):
    """Exact frozen input allowlist, no arbitrary host paths or recursive copy."""
    target.mkdir()
    for row in spec["inputs"]:
        src = safe_file(root / "fixtures" / spec["case"] / str(spec["episode"]), row["name"])
        body = src.read_bytes()
        if digest(body) != row["sha256"]:
            raise ValueError("input_hash_mismatch")
        if any(secret in body for secret in forbidden):
            raise ValueError("oracle_contamination")
        write_new(target / row["name"], body)
    return files_manifest(target)


def jail_command(inputs: Path, state: Path, product: Path, variant: str, evaluator_root: Path):
    # Fixed mount list; no repo, oracle, evaluator logs, operator HOME or credentials.
    return ["/usr/bin/bwrap", "--unshare-all", "--die-with-parent", "--new-session",
            "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib",
            "--ro-bind", "/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev",
            "--tmpfs", "/tmp", "--clearenv", "--setenv", "PATH", "/usr/bin",
            "--setenv", "LANG", "C.UTF-8", "--ro-bind", str(product), "/product/workagent",
            "--ro-bind", str(REPO / "backend/.venv/lib/python3.12/site-packages"), "/deps",
            "--ro-bind", str(REPO / "evaluation/transport_probe.py"), "/probe.py",
            "--ro-bind", str(inputs), "/inputs", "--bind", str(state), "/state",
            "--chdir", "/state", "--", "/usr/bin/python3", "-I", "-B", "/probe.py", variant, str(evaluator_root)]


def run_study(root: Path, output: Path, families="ABCDEFG", repeats=(1, 2)):
    root = external_root(root)
    manifest = load_study(root)
    from runtime_binding import inventory, validate
    runtime_lock = json.loads((root / 'runtime-lock.json').read_text())
    validate(runtime_lock, inventory(REPO, root))
    if output.exists():
        raise ValueError("never_overwrite_attempts")
    output = output.resolve()
    if root not in output.parents or output.parent != root / "execution-records":
        raise ValueError("execution_records_must_stay_in_evaluator_root")
    baseline = REPO / ".local/batch3/b35b/baseline/workagent"
    candidate = REPO / "backend/workagent"
    if source_manifest(baseline) != manifest["baseline_source"]:
        raise ValueError("baseline_source_drift")
    if source_manifest(candidate) != manifest["candidate_source"]:
        raise ValueError("candidate_source_drift")
    output.mkdir(parents=True)
    harness_sources = {p.name: digest(p.read_bytes()) for p in (REPO / 'evaluation').glob('*.py')}
    write_new(output / 'harness-source.json', canonical(harness_sources))
    write_new(output / 'runtime-lock.json', canonical(runtime_lock))
    write_new(output / 'run-contract.json', canonical({'controller_python': sys.version,
        'child_python': runtime_lock['child'], 'runtime_lock_sha256': digest(canonical(runtime_lock)), 'network': 'unshare-all',
        'mounts': ['/usr', '/lib', '/lib64', '/product/workagent', '/deps', '/probe.py', '/inputs', '/state'],
        'mode': 'offline_transport_probe', 'fresh_store_per_variant': True,
        'family_filter': families, 'repeats': list(repeats), 'expected_episodes': sum(len(t['episodes']) for t in json.loads((root/'trajectories/schedule.json').read_text()) if t['family'] in families and t['repeat'] in repeats)}))
    forbidden = [bytes.fromhex(x) for x in json.loads((root / "oracles/custody.json").read_text())["canaries_hex"]]
    schedule = json.loads((root / "trajectories/schedule.json").read_text())
    records = []
    for trial in schedule:
        if trial["family"] not in families or trial["repeat"] not in repeats:
            continue
        run_dir = output / trial["blind_id"]
        run_dir.mkdir()
        state = run_dir / "store"
        state.mkdir()
        store_id = str(uuid.uuid4())
        write_new(state / "identity.json", canonical({"store_id": store_id}))
        for spec in trial["episodes"]:
            attempt = {"blind_id": trial["blind_id"], "episode": spec["episode"],
                       "store_id": store_id, "mode": "offline_transport_probe", "started_ns": time.time_ns(),
                       "provider_calls": 0, "outcome": "attempt_started"}
            slot = run_dir / str(spec["episode"])
            slot.mkdir()
            # Journal is appended before staging; a failure cannot disappear.
            with (output / "attempts.jsonl").open("ab") as journal:
                journal.write(canonical(attempt) + b"\n")
            try:
                attempt["inputs"] = stage_episode(root, spec, slot / "inputs", forbidden)
                product = baseline if trial["variant"] == "B0" else candidate
                proc = subprocess.run(jail_command(slot / "inputs", state, product, trial["variant"], root),
                                      env={"PATH": "/usr/bin:/bin"}, stdin=subprocess.DEVNULL,
                                      capture_output=True, timeout=30, check=False)
                write_new(slot / "stdout", proc.stdout)
                write_new(slot / "stderr", proc.stderr)
                attempt["exit_code"] = proc.returncode
                if proc.returncode != 0:
                    raise ValueError("probe_failed")
                receipt = json.loads(proc.stdout)
                if not all(receipt["denials"].values()) or receipt["provider_calls"] != 0:
                    raise ValueError("isolation_failure")
                if receipt["previous_episodes"] != spec["episode"] - 1 or receipt["store_id"] != store_id:
                    raise ValueError("continuity_failure")
                request = (state / f"request-{spec['episode']}.json").read_bytes()
                if any(s in request for s in forbidden):
                    raise ValueError("oracle_entered_request")
                attempt["request_sha256"] = digest(request)
                attempt["receipt"] = receipt
                attempt["outcome"] = "mechanism_pass_not_usefulness"
            except Exception as exc:
                # Exact stdout/stderr are evaluator-private; sanitized failure remains public-safe.
                attempt["outcome"] = "failed"
                attempt["error_class"] = type(exc).__name__
            attempt["ended_ns"] = time.time_ns()
            attempt["outputs"] = files_manifest(state)
            write_new(slot / "result.json", canonical(attempt))
            with (output / "attempts.jsonl").open("ab") as journal:
                journal.write(canonical(attempt) + b"\n")
            records.append(attempt)
            if attempt["outcome"] == "failed":
                break  # Never average an isolation failure away.
        if records[-1]["outcome"] == "failed":
            break
    summary = {"study_id": manifest["study_id"], "manifest_sha256": digest((root / "manifest.json").read_bytes()),
               "attempts": len(records), "passed": sum(r["outcome"] != "failed" for r in records),
               "provider_calls": 0, "live_trials": 0, "usefulness": "unmeasured",
               "source": manifest["candidate_sha"], "records_sha256": digest(canonical(records)),
               "outcomes": records}
    write_new(output / "summary.json", canonical(summary))
    validate(runtime_lock, inventory(REPO, root))
    write_new(output / 'runtime-end-verified.json', canonical({'unchanged': True}))
    write_new(output / "artifact-manifest.json", canonical(files_manifest(output)))
    return summary


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--mode", choices=("offline", "live"), default="offline")
    p.add_argument("--families", default="ABCDEFG")
    args = p.parse_args()
    if args.mode != "offline":
        p.exit(2, "live_trials_unfunded: this harness cannot dispatch providers; use successor admission preflight\n")
    result = run_study(args.root, args.output, args.families)
    print(json.dumps({k: v for k, v in result.items() if k != "outcomes"}, indent=2))
    return 0 if result["passed"] == result["attempts"] and result["attempts"] else 1


if __name__ == "__main__":
    sys.exit(main())
