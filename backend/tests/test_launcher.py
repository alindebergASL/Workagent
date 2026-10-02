"""Fixture children receive local app credentials, never ambient provider keys."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def test_fixture_environment_drops_host_provider_credentials(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("local_launcher", ROOT / "scripts/workagent.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ["QWEN_TOKEN_PLAN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN"]:
        monkeypatch.setenv(name, "synthetic-not-a-credential")
    path = tmp_path / "local.env"
    path.write_text("DATABASE_URL=synthetic-database\nMIGRATION_DATABASE_URL=synthetic-admin\nLOCAL_BEARER_TOKEN=synthetic-local-token\n")
    env = module.environment(path)
    assert not any(name.endswith("API_KEY") for name in env)
    assert "ANTHROPIC_AUTH_TOKEN" not in env
    assert "MIGRATION_DATABASE_URL" not in env
    assert env["LOCAL_BEARER_TOKEN"] == "synthetic-local-token"


def test_model_recovery_import_has_no_provider_or_cli_side_effect(monkeypatch):
    import urllib.request
    def forbidden(*args, **kwargs):
        raise AssertionError("Import attempted network access")
    monkeypatch.setattr(urllib.request, "urlopen", forbidden)
    spec = importlib.util.spec_from_file_location("model_recovery", ROOT / "scripts/model_responsibility_proof.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert callable(module.main)
