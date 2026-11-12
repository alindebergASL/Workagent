"""Exact wire validation and decimal envelopes. No credentials or network I/O."""
from __future__ import annotations
import hashlib
import json
from decimal import Decimal, InvalidOperation, ROUND_CEILING

MICRO = Decimal('0.000001')
MAX_JSON = 8_000_000
# This is a pricing basis, not an authority token. Source/assumptions are in
# the adjacent README. The certificate still supplies the only funding.
PRICING_BASIS = 'openrouter-text-context-v1'


def jev_policy(prompt_price=1, completion_price=5, request_price=0):
    """Conservative default: reserve a full context for input AND completion.

    The outgoing max_tokens remains 4096. Reserving the full context separately
    also covers reasoning within that context without relying on chars/4 or
    every endpoint treating max_tokens identically.
    """
    return dict(version=2, pricingBasis=PRICING_BASIS, route='typesafe/jev-router',
        provider=dict(max_price=dict(prompt=prompt_price, completion=completion_price,
                                     request=request_price, image=0),
                      allow_fallbacks=False, require_parameters=True),
        maxRequestBytes=1_000_000, maxOutputTokens=4096,
        inputTokenCeiling=1_000_000, completionTokenCeiling=1_000_000,
        extraChargeUsd='0')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate_json_key')
            result[key] = value
        return result
    def invalid(_):
        raise ValueError('invalid_json_number')
    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


def money(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError('invalid_money')
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise ValueError('invalid_money') from None
    if not result.is_finite() or result < 0 or result > Decimal('1000000'):
        raise ValueError('invalid_money')
    return result


def validate_policy(policy):
    required = {'version', 'route', 'provider', 'maxRequestBytes', 'maxOutputTokens',
                'inputTokenCeiling', 'completionTokenCeiling', 'extraChargeUsd', 'pricingBasis'}
    if not isinstance(policy, dict) or set(policy) != required or policy['version'] != 2 or policy.get('pricingBasis') != PRICING_BASIS:
        raise ValueError('invalid_policy')
    if not isinstance(policy['route'], str) or not policy['route'] or len(policy['route']) > 200:
        raise ValueError('invalid_route')
    for key, maximum in [('maxRequestBytes', 1_000_000), ('maxOutputTokens', 4096), ('inputTokenCeiling', 100_000_000), ('completionTokenCeiling', 100_000_000)]:
        if type(policy[key]) is not int or not 0 < policy[key] <= maximum:
            raise ValueError('invalid_policy_bound')
    provider = policy['provider']
    if (not isinstance(provider, dict) or not {'max_price', 'allow_fallbacks', 'require_parameters'} <= set(provider)
            or set(provider) - {'max_price', 'allow_fallbacks', 'require_parameters', 'only'}
            or provider['allow_fallbacks'] is not False or provider['require_parameters'] is not True
            or not isinstance(provider.get('only', []), list)
            or any(not isinstance(p, str) or not p for p in provider.get('only', []))):
        raise ValueError('invalid_provider_policy')
    prices = provider['max_price']
    if not isinstance(prices, dict) or set(prices) != {'prompt', 'completion', 'request', 'image'}:
        raise ValueError('invalid_price_dimensions')
    for price in prices.values():
        # OpenRouter accepts JSON numbers, not our ledger's decimal strings.
        if type(price) not in (int, float):
            raise ValueError('invalid_wire_price')
        money(price)
    if prices['image'] != 0:
        raise ValueError('media_disabled')
    money(policy['extraChargeUsd'])
    if policy['completionTokenCeiling'] < policy['maxOutputTokens']:
        raise ValueError('invalid_completion_envelope')
    # Jev FAQ documents a maximum 1M context. Do not lower the aggregate
    # reserve merely because this particular text body is short.
    if policy['route'] == 'typesafe/jev-router' and min(
            policy['inputTokenCeiling'], policy['completionTokenCeiling']) < 1_000_000:
        raise ValueError('context_envelope_too_small')
    return policy


def price_envelope(policy):
    validate_policy(policy)
    p = policy['provider']['max_price']
    # Reserve the ENTIRE documented accepted input ceiling, not chars/4 or an
    # unverified tokenizer estimate. Tools, chat framing and replay are included.
    amount = ((Decimal(policy['inputTokenCeiling']) * money(p['prompt'])
               + Decimal(policy['completionTokenCeiling']) * money(p['completion'])) / 1_000_000
              + money(p['request']) + money(policy['extraChargeUsd']))
    return amount.quantize(MICRO, rounding=ROUND_CEILING)


def validate_request(request, policy):
    validate_policy(policy)
    raw = request.get('requestBody')
    if not isinstance(raw, str) or not 0 < len(raw.encode('utf-8')) <= policy['maxRequestBytes']:
        raise ValueError('invalid_request_bound')
    body = strict_json(raw)
    required = {'model', 'messages', 'stream', 'stream_options', 'session_id', 'max_tokens', 'provider', 'prompt_cache_options'}
    if not isinstance(body, dict) or not required <= set(body) or set(body) - required - {'tools', 'reasoning'}:
        raise ValueError('unsupported_request_field')
    if (body['model'] != policy['route'] or request.get('route') != body['model']
            or body['session_id'] != request.get('sessionId') or body['stream'] is not True
            or body['stream_options'] != {'include_usage': True}
            or body['provider'] != policy['provider']
            or body['prompt_cache_options'] != {'mode': 'explicit'}):
        raise ValueError('policy_binding_conflict')
    cap = body['max_tokens']
    if type(cap) is not int or not 0 < cap <= policy['maxOutputTokens'] or cap != request.get('maxOutputTokens'):
        raise ValueError('invalid_output_bound')
    if (request.get('requestHash') != digest(raw) or request.get('requestBytes') != len(raw.encode('utf-8'))
            or request.get('purpose') != 'conversation'):
        raise ValueError('request_identity_conflict')
    if not isinstance(body['messages'], list) or not body['messages']:
        raise ValueError('invalid_messages')
    for msg in body['messages']:
        if (not isinstance(msg, dict) or set(msg) - {'role', 'content', 'tool_call_id', 'tool_calls', 'reasoning_details'}
                or msg.get('role') not in ('system', 'user', 'assistant', 'tool') or not isinstance(msg.get('content'), str)):
            raise ValueError('unsupported_modality')
        if 'reasoning_details' in msg:
            if not isinstance(msg['reasoning_details'], list):
                raise ValueError('unsupported_replay')
            for detail in msg['reasoning_details']:
                if (not isinstance(detail, dict) or detail.get('type') not in
                        ('reasoning.text', 'reasoning.summary', 'reasoning.encrypted')
                        or set(detail) - {'type', 'text', 'summary', 'data', 'signature', 'id', 'format', 'index'}):
                    raise ValueError('unsupported_replay')
        if 'tool_calls' in msg:
            for call in msg['tool_calls']:
                if (set(call) != {'id', 'type', 'function'} or call['type'] != 'function'
                        or set(call['function']) != {'name', 'arguments'}
                        or not isinstance(call['function']['arguments'], str)):
                    raise ValueError('invalid_tool_call')
    for tool in body.get('tools', []):
        if (not isinstance(tool, dict) or set(tool) != {'type', 'function'} or tool['type'] != 'function'
                or set(tool['function']) - {'name', 'description', 'parameters'}):
            raise ValueError('unsupported_tool')
    if 'reasoning' in body and (not isinstance(body['reasoning'], dict) or set(body['reasoning']) != {'effort'}
                              or body['reasoning']['effort'] not in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')):
        raise ValueError('unsupported_reasoning')
    return price_envelope(policy)


def certificate_identity(certificate, binding):
    expected = {'issuer_database', 'issuer_schema', 'id', 'target_database', 'target_binding_sha256', 'amount_usd'}
    if not isinstance(certificate, dict) or set(certificate) != expected:
        raise ValueError('invalid_certificate')
    if (certificate['issuer_database'] != 'workagent_test_47b87fe3b82e'
            or certificate['issuer_schema'] != 'test_budget_correction'
            or certificate['target_database'] != binding['target_database']
            or certificate['target_binding_sha256'] != binding['binding_sha256']
            or not isinstance(certificate['id'], str) or not certificate['id']):
        raise ValueError('certificate_identity_conflict')
    amount = money(certificate['amount_usd'])
    if not 0 < amount <= Decimal('275') or amount != amount.quantize(MICRO):
        raise ValueError('invalid_certificate_amount')
    return amount
