"""B01 envelope boundary for the certificate-funded PostgreSQL adapter.

The service uses PostgresAccounting; protocol fixtures do not establish live
funding. No legacy task/profile/Responses execution semantics are imported.
"""
from __future__ import annotations
import json
import re
from typing import Protocol


class AccountingStore(Protocol):
    def reserve_workspace_attempt(self, request: dict) -> dict:
        """Atomically check live authority and headroom; reserve a conservative
        bound for the entire routed request and return its durable identity.
        Router tier/preferences are NOT bounds. No grant mutation or refunds.
        """
    def dispatch_workspace_attempt(self, request: dict) -> dict:
        """Fresh authority + one-use dispatch commit. A repeat must refuse, not
        return send permission. Crashes after this commit retain the liability.
        """
    def retain_workspace_attempt(self, receipt: dict) -> dict:
        """Write-only receipt retention survives revoke; preserve raw usage,
        resolved route and unknown outcomes. Never blindly replay/refund.
        """


def _string(data: dict, key: str, maximum: int = 200) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValueError(f"invalid_{key}")
    return value


def _binding(data: dict) -> None:
    _string(data, "reservationId")
    if not re.fullmatch(r"[a-f0-9]{64}", _string(data, "requestHash")):
        raise ValueError("invalid_requestHash")


class WorkspaceAccountingBridge:
    def __init__(self, issuer: AccountingStore):
        self.issuer = issuer

    def reserve(self, request: dict) -> dict:
        _string(request, "sessionId")
        route = _string(request, "route")
        if route == "typesafe/jev-1.14" or request.get("purpose") != "conversation":
            raise ValueError("inference_path_disabled")
        if not re.fullmatch(r"[a-f0-9]{64}", _string(request, "requestHash")):
            raise ValueError("invalid_requestHash")
        cap = request.get("maxOutputTokens")
        if type(cap) is not int or not 0 < cap <= 4096:
            raise ValueError("invalid_output_bound")
        if type(request.get("requestBytes")) is not int or not 0 < request["requestBytes"] <= 1_000_000:
            raise ValueError("invalid_request_bound")
        # Only issuer-owned policy can price/bound this route and reserve money.
        permit = self.issuer.reserve_workspace_attempt(dict(request))
        _binding(permit)
        if (permit.get("durable") is not True or permit["requestHash"] != request["requestHash"]
                or permit.get("route") != route):
            raise ValueError("invalid_issuer_permit")
        return permit

    def dispatch(self, request: dict) -> dict:
        _binding(request)
        result = self.issuer.dispatch_workspace_attempt(dict(request))
        if result.get("dispatched") is not True:
            raise ValueError("issuer_dispatch_refused")
        return result

    def retain(self, receipt: dict) -> dict:
        _binding(receipt)
        if receipt.get("outcome") not in ("received", "unknown", "not_dispatched", "reconciled"):
            raise ValueError("invalid_outcome")
        if receipt["outcome"] in ("received", "reconciled"):
            _string(receipt, "responseId"); _string(receipt, "resolvedModel")
            # Malformed/missing monetary or token usage is evidence too. The
            # adapter retains it as unverified without releasing liability.
        # JSON round trip rejects exotic caller objects; no economic inference.
        value = json.loads(json.dumps(receipt, allow_nan=False))
        result = self.issuer.retain_workspace_attempt(value)
        if result.get("retained") is not True:
            raise ValueError("issuer_retention_unconfirmed")
        return result
