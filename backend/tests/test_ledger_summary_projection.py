"""Accounting reads must not repeatedly transfer retained response/tool bodies."""
from decimal import Decimal
import pytest
from test_domain import context
from test_conversations import conversation,post
from test_general_responses import activate,Provider,worker
from workagent.responses_ledger import summary


def legacy_summary(c,grant_id,shared):
    """Independent pre-optimization calculation, including exact decimal strings."""
    predicate='s.grant_id IN (SELECT responses_budget_grants(%s))' if shared else 's.grant_id=%s'
    rows=c.execute('SELECT e.kind,e.data FROM responses_events e JOIN responses_steps s USING(attempt_id,phase) WHERE '+predicate,(grant_id,)).fetchall()
    counts={k:sum(r['kind']==k for r in rows) for k in ('count_send','dispatch','read','cancel')}
    reservations=[r['data'] for r in rows if r['kind']=='dispatch']
    usages=[r['data']['usage'] for r in rows if r['kind']=='result' and r['data'].get('usage')]
    unknown=len(reservations)-len(usages)
    calculated=sum((Decimal(u['input_tokens'])*Decimal('2.5')+Decimal(u['output_tokens'])*Decimal('10'))/Decimal(1000000) for u in usages)
    carried=Decimal(0);carry_fields={}
    if shared:
        carry=c.execute('''SELECT count(*) AS n, coalesce(sum(b.reserved_cost_usd),0) AS cost
            FROM responses_budget_carry b JOIN provider_grants g ON g.id=%s
            WHERE b.project_id=g.data->'responses'->>'project_id'
              AND b.transport_mode=g.data->'responses'->>'transport_mode' ''',(grant_id,)).fetchone()
        carried=carry['cost']
        if carry['n']:carry_fields={'carried_reserved_cost_usd':str(carried)}
    return {**carry_fields,'request_counts':counts,
        'reserved_input_tokens':sum(r['reserved_input_tokens'] for r in reservations),
        'reserved_output_tokens':sum(r['reserved_output_tokens'] for r in reservations),
        'reserved_cost_usd':str(carried+sum((Decimal(r['reserved_cost_usd']) for r in reservations),Decimal(0))),
        'reported_usage':{'input_tokens':sum(u['input_tokens'] for u in usages),'output_tokens':sum(u['output_tokens'] for u in usages)},
        'unknown_usage_steps':unknown,'conservatively_calculated_cost_usd':str(calculated) if not unknown else None,
        'billed_cost_usd':None,'cost_basis':'undiscounted reservation rates; not provider billing'}


class AccountingOnly:
    """Records every ledger read so the test can prove no event bodies were transferred."""
    def __init__(self,c):self.c=c;self.statements=[]
    def execute(self,sql,*args):
        if 'responses_events' in sql:self.statements.append(sql)
        return self.c.execute(sql,*args)


def equivalent(actual,expected):
    """Equal accounting; cost strings compare as decimals ('0.0075' == '0.00750')."""
    money={'reserved_cost_usd','conservatively_calculated_cost_usd','carried_reserved_cost_usd','billed_cost_usd'}
    assert set(actual)==set(expected)
    for key in expected:
        a,e=actual[key],expected[key]
        if key in money and a is not None and e is not None:
            assert Decimal(a)==Decimal(e),key
        else:
            assert a==e,key


@pytest.mark.parametrize('shared',[False,True])
@pytest.mark.parametrize('lose_id',[False,True])
def test_summary_preserves_accounting_without_response_bodies(context,tmp_path,shared,lose_id):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,[cv])
    with s.db.transaction() as c:
        equivalent(summary(c,g.id,shared=shared),legacy_summary(c,g.id,shared))
    fake=Provider(lose_id=lose_id);w=worker(context,fake,tmp_path)
    q=post(context,cv,'Explain this synthetic tradeoff.')
    w.work(p,ws,q.run.id)
    with s.db.transaction() as c:
        proxy=AccountingOnly(c);actual=summary(proxy,g.id,shared=shared)
        equivalent(actual,legacy_summary(c,g.id,shared))
    assert actual['request_counts']['dispatch']>0
    assert (actual['unknown_usage_steps']>0)==lose_id
    # The ledger read is one aggregate over accounting fields; it never selects
    # whole event rows, retained response bodies or tool values.
    assert proxy.statements
    for sql in proxy.statements:
        assert 'count(*)' in sql and 'sum(' in sql
        assert 'SELECT e.kind,e.data' not in sql and "e.data->'value'" not in sql and 'SELECT *' not in sql
