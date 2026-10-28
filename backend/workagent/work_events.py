"""Authorized paging and attention over transactionally captured canonical events."""
from .errors import DomainError, deny
from .models import now
from .work_event_models import WorkEvent, EventPage, AttentionPage, AttentionSeenResult

VISIBLE = '''work_reference_visible(e.workspace_id,%s,e.conversation_id,
    e.artifact_id,e.proposal_id,e.assignment_id,e.run_id)'''
# One durable fact per selected material event. Artifact pointer/audit duplicates
# do not create extra bells. Seen never accepts or dismisses a domain decision.
ATTENTION = """(e.type='revision.created' OR
    (e.type='proposal.changed' AND e.reason_code='review_required') OR
    e.type='responsibility.changed' OR e.reason_code='cancelled_unapplied')"""


def event_model(row):
    return WorkEvent(**{key: str(row[key]) if key == 'event_id' else row[key]
                        for key in WorkEvent.model_fields})


class WorkEvents:
    def __init__(self, service, codec):
        self.service, self.codec = service, codec

    def scope(self, c, p, ws, cid):
        generation = self.service._scope(c, p, ws)
        cv = self.service._conversation(c, p, ws, cid)
        if cv.owner_id != p.id:
            deny()
        return cv, generation

    def token(self, event_id, p, ws, cid, generation):
        return self.codec.encode(event_id, ws, p.id, cid, generation)

    def head(self, c, ws):
        row = c.execute('SELECT * FROM work_event_heads WHERE workspace_id=%s', (ws,)).fetchone()
        if row is None:
            # Migration or canonical workspace INSERT must allocate the baseline.
            # Never repair missing projection state from a GET.
            raise DomainError('internal_error')
        return row

    def resolve(self, c, p, ws, cid, generation, token, head):
        event_id, signed_generation = self.codec.decode(token, ws, p.id, cid)
        if signed_generation != generation:
            return None
        if event_id == str(head['baseline_id']):
            position = 0
        else:
            row = c.execute(f'''SELECT e.position,{VISIBLE} AS visible FROM work_events e
                WHERE e.workspace_id=%s AND e.conversation_id=%s AND e.event_id=%s''',
                (p.id, ws, cid, event_id)).fetchone()
            if row is None:
                return None
            if not row['visible']:
                deny()
            position = row['position']
        return position if position >= head['retained_floor'] else None

    def watermark(self, c, p, ws, cid, generation, head=None):
        head = head or self.head(c, ws)
        row = c.execute(f'''SELECT e.event_id FROM work_events e
            WHERE e.workspace_id=%s AND e.conversation_id=%s AND {VISIBLE}
            ORDER BY e.position DESC LIMIT 1''', (ws, cid, p.id)).fetchone()
        return self.token(row['event_id'] if row else head['baseline_id'], p, ws, cid, generation)

    def _page(self, c, p, ws, cid, generation, after, limit, *, attention=False, start=None):
        head = self.head(c, ws)
        position = self.resolve(c,p,ws,cid,generation,after,head) if after else (start or 0)
        if position is None or position < head['retained_floor']:
            return EventPage(events=[], next_cursor=self.watermark(c,p,ws,cid,generation,head),
                             has_more=False, reset_required=True, checked_at=now())
        # Filter before LIMIT. Hidden records never consume a visible page slot or
        # produce hidden counts; limit+1 is the authorized lookahead.
        rows = c.execute(f'''SELECT e.* FROM work_events e
            WHERE e.workspace_id=%s AND e.conversation_id=%s AND e.position>%s
              AND {VISIBLE} {'AND '+ATTENTION if attention else ''}
            ORDER BY e.position LIMIT %s''', (ws,cid,position,p.id,limit+1)).fetchall()
        selected = rows[:limit]
        cursor = (self.token(selected[-1]['event_id'],p,ws,cid,generation) if selected else
                  after or self.watermark(c,p,ws,cid,generation,head))
        return EventPage(events=[event_model(r) for r in selected], next_cursor=cursor,
                         has_more=len(rows)>limit, checked_at=now())

    def authorize_stream(self, p, ws, cid, cursor):
        """Fresh authority for one buffered emission, without retaining a DB lease."""
        with self.service.db.transaction() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            _, generation = self.scope(c,p,ws,cid)
            if self.resolve(c,p,ws,cid,generation,cursor,self.head(c,ws)) is None:
                deny()

    def page(self, p, ws, cid, after=None, limit=100):
        if not 1 <= limit <= 100:
            raise DomainError('validation_error', fields=['limit'])
        with self.service.db.transaction() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            _, generation = self.scope(c,p,ws,cid)
            return self._page(c,p,ws,cid,generation,after,limit)

    def attention(self, p, ws, cid, after=None, limit=100):
        if not 1 <= limit <= 100:
            raise DomainError('validation_error', fields=['limit'])
        with self.service.db.transaction() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            _, generation = self.scope(c,p,ws,cid)
            seen = c.execute('''SELECT position FROM work_attention_seen
                WHERE workspace_id=%s AND principal_id=%s AND conversation_id=%s''', (ws,p.id,cid)).fetchone()
            page = self._page(c,p,ws,cid,generation,after,limit,attention=True,
                              start=seen['position'] if seen else 0)
            return AttentionPage(facts=page.events, **page.model_dump(exclude={'events'}))

    def seen(self, p, ws, command):
        cid = command.conversation_id

        def authorize(c):
            _, generation = self.scope(c,p,ws,cid)
            position = self.resolve(c,p,ws,cid,generation,command.cursor,self.head(c,ws))
            if position is None:
                raise DomainError('version_conflict')
            return generation, position

        def mutate(c, authorized):
            generation, position = authorized
            event_id, _ = self.codec.decode(command.cursor,ws,p.id,cid)
            row = c.execute('''INSERT INTO work_attention_seen
                (workspace_id,principal_id,conversation_id,position,event_id) VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT(workspace_id,principal_id,conversation_id) DO UPDATE
                  SET position=excluded.position,event_id=excluded.event_id
                  WHERE work_attention_seen.position<excluded.position
                RETURNING event_id''', (ws,p.id,cid,position,event_id)).fetchone()
            if row is None:
                row = c.execute('''SELECT event_id FROM work_attention_seen
                    WHERE workspace_id=%s AND principal_id=%s AND conversation_id=%s''', (ws,p.id,cid)).fetchone()
            cursor = self.token(row['event_id'],p,ws,cid,generation)
            if self.resolve(c,p,ws,cid,generation,cursor,self.head(c,ws)) is None:
                raise DomainError('version_conflict')
            return AttentionSeenResult(conversation_id=cid,cursor=cursor)

        return self.service._command(p,ws,'attention_seen',{},command,AttentionSeenResult,authorize,mutate)
