"""Offline CI-repair packaging; never starts services or downloads artifacts."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
import hashlib
import json
import re
import socket
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "docs/evidence/batch3-b35a"
BASE = ROOT / ".local/batch3/b35a"
BASELINE = "5887758fadd3f3cf00db180ba2adae88d881113b"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def historical(name):
    return json.loads(subprocess.check_output(
        ["git", "show", f"{BASELINE}:docs/evidence/batch3-b35a/{name}"], cwd=ROOT))


source = historical("SOURCE_MANIFEST.json")
assert len(source) == 60
assert all(sha(ROOT / p) == h for p, h in source.items())
# Keep earlier raw campaigns/client captures and downloaded artifacts immutable.
old_evidence = historical("EVIDENCE_MANIFEST.json")
mutable = {"ACCEPTANCE.md", "HANDOFF.md", "ATTEMPTS.md", "REVIEW_FINAL.md",
           "SOURCE_MANIFEST.json", "PRIVACY.json", "CLIENT_BUILD_BINDING.json",
           "outputs/B3.5a-safety-proof.zip"}
assert all(sha(OUT / p) == h for p, h in old_evidence.items() if p not in mutable)
for p in ["web/src/lib/memory-contract.ts", "web/src/components/MemoryPanel.tsx",
          "web/test/memory-source-ref.test.ts", "web/test/memory-commands.test.ts",
          "web/test/memory-reads.test.ts", "web/test/memory-procedure.test.ts"]:
    source[p] = sha(ROOT / p)
dump(OUT / "SOURCE_MANIFEST.json", dict(sorted(source.items())))

report = json.loads((BASE / "bridge-vitest-02.json").read_text())
assert report["success"] and report["numPassedTests"] == 63
assert report["numFailedTests"] == report["numPendingTests"] == 0
checks = [
    ["node", "node_modules/typescript/bin/tsc", "--noEmit"],
    ["node", "node_modules/prettier/bin/prettier.cjs", "--check",
     "src/lib/memory-contract.ts", "test/memory-source-ref.test.ts"],
    ["node", "node_modules/eslint/bin/eslint.js", "src/lib/memory-contract.ts",
     "test/memory-source-ref.test.ts", "--max-warnings", "0"],
]
commands = []
for label, cmd in zip(["typecheck", "format", "lint"], checks):
    result = subprocess.run(cmd, cwd=ROOT / "web", capture_output=True, text=True)
    log = OUT / f"results/bridge-{label}.log"
    log.write_text(result.stdout + result.stderr)
    commands.append({"command": cmd, "cwd": "web", "exit_code": result.returncode,
                     "log": str(log.relative_to(OUT)), "sha256": sha(log)})
    assert result.returncode == 0, label
for suffix in ["json", "log"]:
    (OUT / f"results/bridge-vitest-02.{suffix}").write_bytes(
        (BASE / f"bridge-vitest-02.{suffix}").read_bytes())
dump(OUT / "results/bridge-verification.json", {
    "baseline_failed_head": BASELINE, "failed_ci_ids": [40895284299, 40895268881],
    "runner": "node node_modules/vitest/vitest.mjs run test/memory-source-ref.test.ts test/memory-commands.test.ts test/memory-reads.test.ts test/memory-procedure.test.ts --reporter=default --reporter=json --outputFile=../.local/batch3/b35a/bridge-vitest-02.json",
    "cwd": "web", "tests_passed": 63, "test_files": len(report["testResults"]),
    "failed": 0, "skipped": 0, "bridge_tests": 3, "commands": commands,
    "render_scope": "formatter and React text-child sink; not mounted panel/browser",
    "source_hashes": {p: h for p, h in source.items() if p.startswith("web/")},
    "independent_review_covers_bridge": False, "parent_review": "BRIDGE_REVIEW.md",
    "paid_product_calls": 0})

old_build = json.loads((ROOT / "docs/evidence/batch3-b34a/BUILD_MANIFEST.json").read_text())
build = ROOT / old_build["directory"]
assert all(sha(build / p) == h for p, h in old_build["outputs"].items())
changes = []
for p, h in old_build["inputs"].items():
    current = sha(ROOT / p) if (ROOT / p).is_file() else None
    if current != h:
        changes.append({"path": p, "consumed_sha256": h, "current_sha256": current})
web_changes = [c["path"] for c in changes if c["path"].startswith("web/src/")]
assert web_changes == ["web/src/lib/memory-contract.ts"], web_changes
assert sha(ROOT / "web/src/components/MemoryPanel.tsx") == old_build["inputs"]["web/src/components/MemoryPanel.tsx"]
dump(OUT / "CLIENT_BUILD_BINDING.json", {
    "build_id": (build / "BUILD_ID").read_text().strip(),
    "build_manifest_sha256": sha(build / "build-manifest.json"),
    "historical_build_binding": "docs/evidence/batch3-b34a/BUILD_MANIFEST.json",
    "historical_build_binding_sha256": sha(ROOT / "docs/evidence/batch3-b34a/BUILD_MANIFEST.json"),
    "retained_outputs_verified": len(old_build["outputs"]),
    "compared_inputs": len(old_build["inputs"]), "current_input_differences": changes,
    "web_source_changed_in_increment": True, "exact_current_build": False,
    "actual_http_and_browser_readbacks": "clients/restart/results.json",
    "original_60_source_hashes_unchanged": True,
    "reused_scope": "unchanged correct/forget/revoke/readback paths; not new memory reference rendering",
    "new_render_verification": "results/bridge-verification.json",
    "current_build_verification": "exact published head frontend CI, bound in attached PUBLICATION_FINAL receipt",
    "services_restarted_for_packaging": False})

readback = json.loads((OUT / "clients/restart/results.json").read_text())
outputs = {}
assert len(readback["readbacks"]) == 5
for row in readback["readbacks"]:
    p = OUT / "outputs" / (row["label"] + "-preserved-human.txt")
    assert sha(p) == row["preserved_human_sha256"]
    outputs[str(p.relative_to(OUT))] = sha(p)
dump(OUT / "OUTPUT_BINDING.json", {
    "verification": "offline hash match of preserved actual HTTP-downloaded bytes; no fresh download",
    "http_receipt": "clients/restart/results.json", "http_receipt_sha256": sha(OUT / "clients/restart/results.json"),
    "outputs": outputs})

for port in [18250, 13250]:
    with socket.socket() as sock:
        assert sock.connect_ex(("127.0.0.1", port)) != 0
state = subprocess.check_output(["systemctl", "show", "workagent-compute-b31a-b35a-final",
                                 "-p", "ActiveState", "-p", "MainPID"], text=True)
assert "ActiveState=inactive" in state and "MainPID=0" in state
dump(OUT / "results/bridge-services-still-stopped.json", {
    "checked_at": datetime.now(timezone.utc).isoformat(),
    "ports_refused": [18250, 13250], "compute_state": state,
    "services_started": False, "installed_services_modified": False})

private = []
for p in BASE.glob("*.env"):
    for line in p.read_text().splitlines():
        if not line.startswith("export "):
            continue
        key, value = line[7:].split("=", 1)
        if ("TOKEN" in key or "DATABASE_URL" in key) and len(value) > 12:
            private.append(value.encode())
        password = urlparse(value).password if "DATABASE_URL" in key else None
        if password:
            private.append(password.encode())
assert private
hits = []
for p in [*(ROOT / p for p in source), ROOT / "STATUS.md", *OUT.rglob("*")]:
    if not p.is_file() or p.suffix in (".png", ".zip"):
        continue
    raw = p.read_bytes()
    if any(s in raw for s in private):
        hits.append(str(p.relative_to(ROOT)))
    for m in re.finditer(rb"postgres(?:ql)?://[^\s/:]+:[^\s/@]+@", raw):
        if not (p == ROOT / "backend/isolated_restore.py" and
                (b"{owner}:{op}@" in m.group() or b"{runtime}:{rp}@" in m.group())):
            hits.append(str(p.relative_to(ROOT)))
assert not hits, hits
lock = sha(ROOT / "contracts/pnpm-lock.yaml")
assert lock == historical("PRIVACY.json")["preserved_unrelated_lock"]
for p in (ROOT / "backend/migrations").glob("*.sql"):
    if p.name[:3].isdigit() and int(p.name[:3]) <= 68:
        old = subprocess.check_output(["git", "show", f"46ec6a3da3178a41a98c949d36d1d0d995d635bf:{p.relative_to(ROOT)}"], cwd=ROOT)
        assert hashlib.sha256(old).hexdigest() == sha(p)
dump(OUT / "PRIVACY.json", {
    "exact_private_value_hits": [], "raw_credential_uri_hits": [], "synthetic_only": True,
    "private_envs_and_backups_excluded": True, "preserved_unrelated_lock": lock,
    "prior_68_migrations_unchanged": True, "original_60_source_hashes_unchanged": True,
    "later_bridge_separately_bound": True, "scan_scope": "source manifest, STATUS and all public text evidence",
    "positive_control_private_values_loaded": True})

zip_path = OUT / "outputs/B3.5a-safety-proof.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted((OUT / "outputs").glob("*.txt")):
        z.write(p, p.name)
    for name in ["ACCEPTANCE.md", "HANDOFF.md", "EVALUATION_MATRIX.md", "ATTEMPTS.md",
                 "REVIEW_FINAL.md", "BRIDGE_REVIEW.md", "SOURCE_MANIFEST.json", "PRIVACY.json",
                 "CLIENT_BUILD_BINDING.json", "OUTPUT_BINDING.json", "SERVICE_SHUTDOWN.json",
                 "results/bridge-verification.json"]:
        z.write(OUT / name, name)
with zipfile.ZipFile(zip_path) as z:
    assert z.testzip() is None
    assert all(z.read(Path(p).name) == (OUT / p).read_bytes() for p in outputs)
manifest = {str(p.relative_to(OUT)): sha(p) for p in sorted(OUT.rglob("*"))
            if p.is_file() and p.name != "EVIDENCE_MANIFEST.json"}
dump(OUT / "EVIDENCE_MANIFEST.json", manifest)
assert all(sha(ROOT / p) == h for p, h in source.items())
assert all(sha(OUT / p) == h for p, h in manifest.items())
print(json.dumps({"source_files": len(source), "evidence_files": len(manifest),
                  "historical_evidence_unchanged": len(old_evidence) - len(mutable),
                  "build_input_differences": changes, "human_outputs_verified": len(outputs),
                  "zip_sha256": sha(zip_path), "privacy_hits": len(hits)}))
