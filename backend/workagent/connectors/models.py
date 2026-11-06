"""Canonical synthetic-only consent contract. No credential material is public."""
from typing import Annotated, Literal
from pydantic import AwareDatetime, Field, ConfigDict
from ..model_base import Model

UUID = Annotated[str, Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')]
class Consent(Model):
    provider: Literal['synthetic'] = 'synthetic'
    account: Literal['Synthetic library'] = 'Synthetic library'
    resource: Literal['synthetic/catalog'] = 'synthetic/catalog'
    effects: list[Literal['read']] = Field(default_factory=lambda:['read'], min_length=1, max_length=1)
    processor: Literal['local-synthetic-mcp'] = 'local-synthetic-mcp'
class StartAuthorization(Model):
    resource: Literal['synthetic/catalog']
    idempotency_key: UUID
class CompleteAuthorization(Model):
    idempotency_key: UUID
class RevokeConnector(CompleteAuthorization):
    expected_generation: int = Field(strict=True, ge=1, le=2147483646)
class AuthorizationFlow(Consent):
    flow_id: UUID
    expires_at: AwareDatetime
    retention: Literal['synthetic-only; no private account access'] = 'synthetic-only; no private account access'
class ConnectorStatus(Consent):
    connector_id: UUID
    state: Literal['connected','revoked','expired','unavailable']
    access_generation: int = Field(strict=True, ge=1)
    expires_at: AwareDatetime
    provider_revocation: Literal['not_requested','pending','failed','revoked']
    reason: str | None = Field(default=None, max_length=200)
class ConnectorPage(Model):
    items: list[ConnectorStatus] = Field(max_length=100)
