"""Read projections reauthorize before returning any tool result to a consumer."""
from ..errors import deny
from ..service import canonical
from .models import ToolObservationV1, ToolAttemptView, ToolAttemptPage
from .policy import readable
from . import registry


def observation(data):
    return ToolObservationV1.model_validate_json(canonical(data))


def page(service,p,ws,rid,*,after=None,limit=50,attempt_id=None):
    if type(limit) is not int or not 1<=limit<=100:
        raise ValueError('bounded page required')
    with service.db.transaction() as c:
        g=readable(service,c,p,ws,rid)
        from ..research import authorize_run_dependencies
        authorize_run_dependencies(c,ws,rid)
        rows=c.execute('''SELECT a.*, e.data AS observation,
              EXISTS(SELECT 1 FROM tool_attempt_events d WHERE d.attempt_id=a.id AND d.kind='dispatch') AS dispatched
            FROM tool_attempts a LEFT JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
            WHERE a.workspace_id=%s AND a.run_id=%s AND (%s::text IS NULL OR a.id>%s)
              AND (%s::text IS NULL OR a.id=%s)
            ORDER BY a.id LIMIT %s''',(ws,rid,after,after,attempt_id,attempt_id,limit+1)).fetchall()
        known=registry.adapters(); items=[]
        for r in rows[:limit]:
            d=known.get(r['capability_id'])
            installed=c.execute('SELECT enabled,descriptor FROM capability_installations WHERE id=%s AND version=%s',
                                (r['capability_id'],r['capability_version'])).fetchone()
            if (d is None or not installed or not installed['enabled'] or installed['descriptor']!=r['descriptor']
                or d.descriptor.model_dump(mode='json')!=r['descriptor'] or r['grant_id']!=g.id):
                deny()
            obs=observation(r['observation']) if r['observation'] else None
            # An uncertain dispatch never becomes a fresh call after restart.
            state=obs.status if obs else ('outcome_unknown' if r['dispatched'] else 'reserved')
            items.append(ToolAttemptView(attempt_id=r['id'],run_id=rid,call_id=r['call_id'],
                         capability_id=r['capability_id'],state=state,observation=obs))
        return ToolAttemptPage(items=items,next_after=rows[limit-1]['id'] if len(rows)>limit else None)


def accounting(c,grant_id,*,shared=False):
    predicate='b.provider_grant_id IN (SELECT responses_budget_grants(%s))' if shared else 'b.provider_grant_id=%s'
    rows=c.execute('''SELECT e.category,e.kind,e.basis,sum(e.units) AS units,sum(e.cost_usd) AS cost
        FROM tool_cost_entries e JOIN tool_attempts a ON a.id=e.attempt_id
        JOIN tool_budget_accounts b ON b.id=a.account_id WHERE '''+predicate+'''
        GROUP BY e.category,e.kind,e.basis ORDER BY e.category,e.kind,e.basis''',(grant_id,)).fetchall()
    if not rows:
        return None
    return {'entries':[{'category':r['category'],'kind':r['kind'],'basis':r['basis'],
                        'units':int(r['units']),'cost_usd':str(r['cost'])} for r in rows],
            'reserved_cost_usd':str(sum(r['cost'] for r in rows if r['kind']=='reserved')),
            'billing':'unknown; reservations are never refunded by observed usage'}
