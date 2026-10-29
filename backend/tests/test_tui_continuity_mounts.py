"""Test-only mapping for this sandbox's root-owned mounts exposed as uid 65534.

Load with pytest -p test_tui_continuity_mounts when needed. Production journal
ownership checks are unchanged; ordinary directories/files are never remapped.
"""
import os
import stat
import pytest

@pytest.fixture(autouse=True)
def mapped_mount_owners(monkeypatch):
    actual=os.fstat
    mounts={(s.st_dev,s.st_ino) for path in ('/tmp','/home')
            if (s:=os.stat(path)).st_uid==65534}
    if not mounts:return
    def fstat(fd):
        info=actual(fd)
        if stat.S_ISDIR(info.st_mode) and (info.st_dev,info.st_ino) in mounts:
            values=list(info);values[4]=0
            return os.stat_result(values)
        return info
    monkeypatch.setattr(os,'fstat',fstat)
