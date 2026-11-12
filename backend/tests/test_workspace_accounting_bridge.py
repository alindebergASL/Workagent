"""Issuer protocol fixtures only: no database, credentials or financial authority."""
import unittest
from workagent.workspace_accounting_bridge import WorkspaceAccountingBridge


class IssuerFixture:
    def __init__(self):
        self.records = []
        self.sent = False
    def reserve_workspace_attempt(self, request):
        self.records.append(request)
        return dict(durable=True, reservationId="retained-authority-id",
                    requestHash=request["requestHash"], route=request["route"])
    def dispatch_workspace_attempt(self, request):
        if self.sent:
            raise ValueError("uncertain_or_already_dispatched")
        self.sent = True
        return dict(dispatched=True)
    def retain_workspace_attempt(self, receipt):
        self.records.append(receipt)
        return dict(retained=True)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.issuer = IssuerFixture()
        self.bridge = WorkspaceAccountingBridge(self.issuer)
        self.request = dict(sessionId="opaque", requestHash="a" * 64,
                            route="typesafe/jev-router", purpose="conversation",
                            maxOutputTokens=4096, requestBytes=400)
    def test_reservation_and_unknown_retention_never_reauthorize_dispatch(self):
        permit = self.bridge.reserve(self.request)
        binding = dict(reservationId=permit["reservationId"], requestHash=permit["requestHash"])
        self.bridge.dispatch(binding)
        self.bridge.retain(dict(**binding, outcome="unknown"))
        with self.assertRaisesRegex(ValueError, "already_dispatched"):
            self.bridge.dispatch(binding)
        self.assertEqual(self.issuer.records[-1]["outcome"], "unknown")
    def test_decisions_and_auxiliary_paths_are_disabled_before_issuer(self):
        for changes in (dict(route="typesafe/jev-1.14"), dict(purpose="compaction"), dict(maxOutputTokens=4097)):
            with self.assertRaises(ValueError):
                self.bridge.reserve(dict(self.request, **changes))
        self.assertEqual(self.issuer.records, [])
    def test_bad_permit_is_not_send_authority(self):
        self.issuer.reserve_workspace_attempt = lambda _: dict(durable=True, reservationId="id", requestHash="b" * 64, route="typesafe/jev-router")
        with self.assertRaisesRegex(ValueError, "invalid_issuer_permit"):
            self.bridge.reserve(self.request)


if __name__ == "__main__":
    unittest.main()
