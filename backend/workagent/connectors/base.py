"""Consent description only. This DTO never installs a grant or credentials."""
from typing import Annotated, Literal
from pydantic import AwareDatetime, Field
from ..model_base import Model

Repository = Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$')]
PROCESSOR = 'github-public-api-v1'

class PublicConnectorConsent(Model):
    account: Literal['public unauthenticated'] = 'public unauthenticated'
    resources: list[Repository] = Field(min_length=1, max_length=100)
    effects: list[Literal['read']] = Field(min_length=1, max_length=1)
    processor: Literal['github-public-api-v1'] = PROCESSOR
    expires_at: AwareDatetime
    access_generation: int = Field(ge=1)
