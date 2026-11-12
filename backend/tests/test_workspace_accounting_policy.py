"""Pure contract tests. Synthetic policy amounts are never funding evidence."""
import copy
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from workagent.workspace_accounting_policy import (jev_policy, canonical, certificate_identity,
    digest, price_envelope, strict_json, validate_policy, validate_request)
from workagent.workspace_accounting_service import AccountingServer


def policy_fixture():
    p = jev_policy()
    p.update(route='fixture/text', inputTokenCeiling=100_000,
             completionTokenCeiling=4096, extraChargeUsd='0.000001')
    p['provider']['max_price']['request'] = 0.001
    return p



def request_fixture(policy=None, session='session', text='Unicode 文 🐱', request_id='request'):
    p = policy or policy_fixture()
    body = dict(model=p['route'], messages=[dict(role='user', content=text)], stream=True,
        stream_options=dict(include_usage=True), session_id=session, max_tokens=4096,
        provider=copy.deepcopy(p['provider']), prompt_cache_options=dict(mode='explicit'))
    raw = json.dumps(body, separators=(',', ':'), ensure_ascii=False)
    return dict(sessionId=session, requestId=request_id, requestHash=digest(raw), requestBody=raw,
                requestBytes=len(raw.encode()), route=p['route'], maxOutputTokens=4096, purpose='conversation')


class PolicyTest(unittest.TestCase):
    def test_exact_final_utf8_hash_and_conservative_context_envelope(self):
        p=policy_fixture(); q=request_fixture(p)
        self.assertEqual(validate_request(q,p), Decimal('0.121481'))
        self.assertEqual(validate_request(request_fixture(p,text='x'),p), validate_request(q,p))
        # Full input ceiling includes framing/replay/tools; no chars/4 inference.
        q['requestBody'] += ' '
        with self.assertRaisesRegex(ValueError,'identity_conflict'):
            validate_request(q,p)

    def test_mutating_body_or_price_limits_is_refused_even_with_new_digest(self):
        p=policy_fixture()
        for mutate in [lambda b: b['provider']['max_price'].update(prompt=100),
                       lambda b: b.update(model='other/model'),
                       lambda b: b.update(plugins=[dict(id='web')]),
                       lambda b: b['messages'][0].update(content=[dict(type='image_url',image_url='x')]),
                       lambda b: b.update(reasoning=dict(max_tokens=20000)),
                       lambda b: b['provider'].update(allow_fallbacks=True),
                       lambda b: b['messages'][0].update(reasoning_details=[dict(type='image_url',url='x')])]:
            q=request_fixture(p); b=strict_json(q['requestBody']); mutate(b)
            q['requestBody']=canonical(b); q['requestHash']=digest(q['requestBody']); q['requestBytes']=len(q['requestBody'].encode())
            with self.assertRaises(ValueError): validate_request(q,p)

    def test_decimal_rounds_up_and_invalid_numbers_cannot_be_funding(self):
        p=policy_fixture(); p['extraChargeUsd']='0.0000011'
        self.assertEqual(price_envelope(p), Decimal('0.121482'))
        for value in ('NaN', 'Infinity', '-0.01', True):
            p['extraChargeUsd']=value
            with self.assertRaises(ValueError): price_envelope(p)
        with self.assertRaises(ValueError): strict_json('{"n":NaN}')
        with self.assertRaises(ValueError): strict_json('{"n":1,"n":2}')

    def test_configured_jev_routes_without_slug_or_single_provider_gate(self):
        p=jev_policy()
        self.assertEqual(validate_request(request_fixture(p),p),Decimal('6.000000'))
        self.assertNotIn('only',p['provider'])
        p['provider']['only']=['provider-a','provider-b']
        validate_policy(p)
        p['completionTokenCeiling']=4096
        with self.assertRaisesRegex(ValueError,'context_envelope_too_small'): validate_policy(p)
        p=jev_policy(); p['inputTokenCeiling']=999999
        with self.assertRaisesRegex(ValueError,'context_envelope_too_small'): validate_policy(p)

    def test_funding_identity_binds_issuer_target_policy_and_exact_amount(self):
        binding=dict(target_database='fresh_target',binding_sha256='a'*64)
        cert=dict(issuer_database='workagent_test_47b87fe3b82e',issuer_schema='test_budget_correction',
                  id='issuer-id',target_database='fresh_target',target_binding_sha256='a'*64,amount_usd='1.000001')
        self.assertEqual(certificate_identity(cert,binding),Decimal('1.000001'))
        for key,value in [('target_database','replayed_target'),('target_binding_sha256','b'*64),
                          ('issuer_database','other'),('issuer_schema','other'),('amount_usd','1.0000001'),
                          ('amount_usd','NaN'),('amount_usd','276')]:
            with self.assertRaises(ValueError): certificate_identity(dict(cert,**{key:value}),binding)

    def test_existing_socket_path_is_never_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'accounting.sock'; path.write_text('human-owned endpoint')
            with self.assertRaisesRegex(ValueError,'already_exists'): AccountingServer(str(path),None)
            self.assertEqual(path.read_text(),'human-owned endpoint')
            path.chmod(0o600)


if __name__ == '__main__': unittest.main()
