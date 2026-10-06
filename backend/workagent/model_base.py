"""Shared type primitives; no product/document serialization defaults."""
from typing import Annotated
from pydantic import BaseModel,ConfigDict,Field

Id = Annotated[str, Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9][A-Za-z0-9_.:-]*$')]
Text = Annotated[str, Field(min_length=1, max_length=10000)]
Hash = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', validate_assignment=True)
