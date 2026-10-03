"""Observed current Responses path, never live transport or key loading."""
import json


def compare(repo, run):
    import sys
    sys.path.insert(0, str(repo / 'backend/tests'))
    from test_domain import context, create
    from test_responses_worker import grant, totals
    from workagent.responses_synthetic import SyntheticResponses
    from workagent.responses_transport import ResponsesTransport
    from workagent.responses_worker import ResponsesWorker
    from workagent.service import Service
    from workagent.db import Database
    import httpx
    rows = {}
    for name in ('normal_two_phase', 'subset_denied', 'tool_escalation_denied'):
        ctx = context.__wrapped__()
        service, p, ws, refs, owner = ctx
        g = grant(ctx); q = create(ctx)
        fake = SyntheticResponses()
        requests = []
        def respond(request):
            requests.append({'method':request.method, 'path':request.url.path,
                'body':json.loads(request.content) if request.content else None})
            response = fake.handle(request)
            if request.method == 'POST' and request.url.path.endswith('/responses'):
                data = json.loads(response.content)
                if data['metadata']['step_id'] == 'selection':
                    call = data['output'][0]
                    if name == 'subset_denied':
                        args = json.loads(call['arguments']); args['source_ids'] = args['source_ids'][:1]
                        call['arguments'] = json.dumps(args)
                    elif name == 'tool_escalation_denied':
                        call['name'] = 'terminal'
                return httpx.Response(200, json=data)
            return response
        transport = ResponsesTransport.synthetic(httpx.MockTransport(respond))
        worker = ResponsesWorker(service, transport, run / name)
        from workagent.errors import DomainError
        def outcome(worker):
            try:
                return worker.run(ws, q.run.id)
            except DomainError as exc:
                return 'domain_error:' + exc.code.value
        result = outcome(worker)
        before = len(requests)
        replay = outcome(ResponsesWorker(Service(Database()), transport, run / name))
        assert len(requests) == before, (name, 'replay dispatched')
        a = service.get_assignment(p, ws, q.assignment.id)
        artifacts = [service.get_artifact(p, ws, aid).model_dump(mode='json') for aid in a.artifact_ids]
        rows[name] = {'result':result, 'replay':replay, 'replay_requests':len(requests)-before,
            'requests':requests, 'ledger':totals(service, g), 'artifact_readback':artifacts}
        if name == 'normal_two_phase':
            assert result == 'completed' and replay == 'reconciled'
            posts = [r['body'] for r in requests if r['path'].endswith('/responses')]
            assert len(posts) == 2 and len(posts[0]['tools']) == 1
            assert posts[0]['tool_choice'] == {'type':'function', 'name':'read_scoped_context'}
            assert posts[1]['tools'] == [] and posts[1]['tool_choice'] == 'none'
            assert len(artifacts) == 1
        else:
            assert result != 'completed' and not artifacts
            assert len([r for r in requests if r['path'].endswith('/responses')]) == 1
        transport.close()
    (run / 'responses_comparison.json').write_text(json.dumps(rows, indent=2, default=str) + '\n')
    print('RESPONSES_COMPARISON', {k:v['result'] for k,v in rows.items()}, flush=True)
