"""Offline adaptive regression runner: never collect the DB-backed suite.

Run from repository root: .venv/bin/python backend/run_adaptive_pure.py
Optional --contracts exports/checks canonical contracts without app startup.
"""
import os
from pathlib import Path
import sys

# Remove DB routes before importing application/tests; never inspect their values.
for key in list(os.environ):
    if any(part in key.upper() for part in ('DATABASE','DSN','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGSERVICE')):
        os.environ.pop(key)
os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD']='1'

import socket
import psycopg


def forbidden(*args,**kwargs):
    raise AssertionError('DB/network forbidden in offline regressions')


psycopg.connect=forbidden
psycopg.Connection.connect=forbidden
psycopg.AsyncConnection.connect=forbidden
socket.create_connection=forbidden
socket.socket.connect=forbidden
socket.socket.connect_ex=forbidden

root=Path(__file__).resolve().parent
sys.path.insert(0,str(root))
if sys.argv[1:]==['--contracts']:
    # create_app only builds schemas; no lifespan/startup/service is invoked.
    import export_contracts
    sys.argv=[sys.argv[0]]
    export_contracts.main()
    sys.argv.append('--check')
    export_contracts.main()
else:
    import pytest
    raise SystemExit(pytest.main(['-q','--noconftest',str(root/'tests/test_adaptive_pure.py')]))
