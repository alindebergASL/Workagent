"""Bounded negative control: CPU proof must reject a wall-guard termination.

Only loaded by the explicitly named negative-control pytest invocation.
No production files, process CPU limits, or default test behavior are modified.
"""
def pytest_runtest_setup(item):
    assert item.name == 'test_real_cpu_bomb_stopped'
    original = item.module.probe

    def short_wall(tmp_path, code, *, timeout=15):
        return original(tmp_path, code, timeout=0.25)

    item.module.probe = short_wall
