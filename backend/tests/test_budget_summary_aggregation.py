"""Aggregate accounting without materializing historical event payloads."""
from decimal import Decimal
import pytest
from test_domain import context
from test_conversations import conversation, post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker
from workagent.responses_ledger import summary


def legacy_summary(c, grant_id, shared):
    predicate='s.grant_id IN (SELECT responses_budget_grants(%s))' if shared else 's.grant_id=%s'
    rows=c.execute('SELECT e.kind,e.data FROM responses_events e JOIN responses_steps s USING(attempt_id,phase) WHERE '+predicate,
                   (grant_id,)).fetchall()
    reservations=[r['data'] for r in rows if r['kind']=='dispatch']
    usages=[r['data']['usage'] for r in rows if r['kind']=='result' and r['data'].get('usage')]
    unknown=len(reservations)-len(usages)
    carry=Decimal(0);extra={}
    if shared:
        row=c.execute("SELECT count(*) n,coalesce(sum(b.reserved_cost_usd),0) cost FROM responses_budget_carry b JOIN provider_grants g ON g.id=%s WHERE b.project_id=g.data->'responses'->>'project_id' AND b.transport_mode=g.data->'responses'->>'transport_mode'",(grant_id,)).fetchone()
        carry=row['cost']
        if row['n']:extra={'carried_reserved_cost_usd':str(carry)}
    return {**extra,'request_counts':{k:sum(r['kind']==k for r in rows) for k in ('count_send','dispatch','read','cancel')},
        'reserved_input_tokens':sum(r['reserved_input_tokens'] for r in reservations),
        'reserved_output_tokens':sum(r['reserved_output_tokens'] for r in reservations),
        'reserved_cost_usd':str(carry+sum((Decimal(r['reserved_cost_usd']) for r in reservations),Decimal(0))),
        'reported_usage':{'input_tokens':sum(u['input_tokens'] for u in usages),'output_tokens':sum(u['output_tokens'] for u in usages)},
        'unknown_usage_steps':unknown,
        'conservatively_calculated_cost_usd':str(sum((Decimal(u['input_tokens'])*Decimal('2.5')+Decimal(u['output_tokens'])*Decimal('10'))/Decimal(1000000) for u in usages)) if not unknown else None,
        'billed_cost_usd':None,'cost_basis':'undiscounted reservation rates; not provider billing'}


class AggregateOnly:
    def __init__(self,c):self.c=c
    def execute(self,query,params=None):
        cursor=self.c.execute(query,params)
        if 'FROM responses_events' in query:
            class OneRow:
                def fetchone(self):return cursor.fetchone()
                def fetchall(self):raise AssertionError('Accounting must aggregate events in SQL, not expand every historical payload')
            return OneRow()
        return cursor


@pytest.mark.parametrize('shared',[False,True])
@pytest.mark.parametrize('lost',[False,True])
def test_summary_aggregate_matches_legacy_empty_and_used(context,tmp_path,shared,lost):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv)
    with s.db.transaction() as c:
        assert summary(AggregateOnly(c),g.id,shared=shared)==legacy_summary(c,g.id,shared)
    fake=AlphaProvider([{'kind':'reply','text':'A useful answer.'}])
    if lost:
        import httpx
        original=fake.handle
        def lose(request):
            if request.method=='POST' and request.url.path=='/v1/responses':
                raise httpx.ReadTimeout('synthetic unknown send',request=request)
            return original(request)
        fake.handle=lose
    q=post(context,cv,'Explain the tradeoff.')
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    with s.db.transaction() as c:
        result=summary(AggregateOnly(c),g.id,shared=shared)
        expected=legacy_summary(c,g.id,shared)
        # A sum performed before Decimal division can remove insignificant zeros
        # (0.00750 -> 0.0075); compare its monetary value, not textual scale.
        calculated='conservatively_calculated_cost_usd'
        if expected[calculated] is not None:
            assert Decimal(result[calculated])==Decimal(expected[calculated])
            expected[calculated]=result[calculated]
        assert result==expected
        assert result['request_counts']['dispatch']>0
