"""One reviewed synthetic server. No user-configured endpoints or discovery URLs."""
import os
from dataclasses import dataclass

PROTOCOL='2026-07-28'
IDENTITY={'name':'workagent-synthetic-catalog','version':'1'}
BASE='http://127.0.0.1:18769'
REDIRECT='http://127.0.0.1:18769/internal/callback'
AUDIENCE='synthetic/catalog'
ALLOWED=frozenset(BASE+p for p in ('/mcp','/oauth/issue','/oauth/token','/oauth/refresh','/oauth/revoke','/metadata'))

def endpoint(url):
    if url not in ALLOWED:raise ValueError('unreviewed endpoint')
    return url

def configured():
    return os.environ.get('WORKAGENT_SYNTHETIC_CONNECTOR')=='1'

def require_enabled():
    if not configured():raise ValueError('synthetic fixture unavailable')
