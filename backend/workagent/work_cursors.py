"""Scope-bound random log identities. Workspace positions never leave storage."""
import base64
import hashlib
import hmac
import json
import re

from .errors import deny

SCHEMA = 'workagent/work-v1'
SHAPE = re.compile(r'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,18})\.([A-Za-z0-9_-]{43})$')


class CursorCodec:
    def __init__(self, secret):
        if len(secret) < 32:
            raise ValueError('private cursor signing key required')
        self._key = hmac.digest(secret.encode(), b'workagent/work-event-cursor/v1', 'sha256')

    def _signature(self, event_id, workspace, principal, conversation, generation):
        data = json.dumps([SCHEMA, workspace, principal, conversation, generation, event_id],
                          separators=(',', ':'), ensure_ascii=True).encode()
        return base64.urlsafe_b64encode(hmac.digest(self._key, data, hashlib.sha256)).decode().rstrip('=')

    def encode(self, event_id, workspace, principal, conversation, generation):
        event_id = str(event_id)
        return f'{event_id}.{generation}.{self._signature(event_id, workspace, principal, conversation, generation)}'

    def decode(self, token, workspace, principal, conversation):
        match = SHAPE.fullmatch(token) if isinstance(token, str) and len(token) <= 128 else None
        if not match:
            deny()
        event_id, generation, signature = match.groups()
        generation = int(generation)
        if not hmac.compare_digest(signature, self._signature(event_id, workspace, principal, conversation, generation)):
            deny()
        return event_id, generation
