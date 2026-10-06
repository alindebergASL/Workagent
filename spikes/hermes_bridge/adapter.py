"""Narrow broker adapter. Upstream owns every model/tool-loop iteration."""
import json
from copy import deepcopy


class BrokerBinding:
    """Bind one reviewed callback, never a model-supplied principal/capability."""
    name = 'get_assignment'

    def __init__(self, broker):
        self.broker = broker
        self.trace = []

    def register(self):
        from tools.registry import registry
        from workagent.tool_registry import TOOLS
        self.input_type = TOOLS[self.name][0]
        registry.register(name=self.name, toolset='workagent_broker', schema={
            'name': self.name, 'description': 'Read the current bound Workagent assignment.',
            'parameters': self.input_type.model_json_schema()}, handler=self.call)

    def call(self, arguments, **kwargs):
        from workagent.errors import DomainError
        from pydantic import ValidationError
        try:
            # Upstream schema hints/coercion are NOT authority. Broker validates too.
            request = self.input_type.model_validate(arguments, strict=True)
            result = self.broker.call(self.name, request.model_dump(mode='json'))
            data = result.model_dump(mode='json')
            self.trace.append({'arguments':arguments, 'outcome':'allowed', 'assignment_id':data['id']})
            return json.dumps(data)
        except (DomainError, ValidationError) as exc:
            code = exc.code.value if isinstance(exc, DomainError) else 'invalid_arguments'
            self.trace.append({'arguments':arguments, 'outcome':'denied', 'code':code})
            return json.dumps({'error':code})


class ControlledProvider:
    """SDK/HTTPX in-memory stream fixtures, not live inference or an HTTP server."""
    def __init__(self, messages, before_response=None):
        self.messages = list(messages)
        self.before_response = before_response
        self.requests = []

    def handle(self, request):
        import httpx
        payload = json.loads(request.content)
        index = len(self.requests)
        self.requests.append({'path':request.url.path, 'body':payload})
        if index >= len(self.messages):
            # BaseException avoids framework retry swallowing a fixture exhaustion.
            raise SystemExit('controlled response budget exceeded')
        if self.before_response:
            self.before_response(index)
        message = deepcopy(self.messages[index])
        end = 'tool_calls' if message.get('tool_calls') else 'stop'
        for i, call in enumerate(message.get('tool_calls', [])):
            call['index'] = i
        response = {'id':f'controlled-{index}', 'object':'chat.completion', 'created':0,
            'model':'bridge-deterministic', 'choices':[{'index':0,'finish_reason':end,'message':message}],
            'usage':{'prompt_tokens':20,'completion_tokens':5,'total_tokens':25}}
        if payload.get('stream'):
            response['object'] = 'chat.completion.chunk'
            response['choices'][0]['delta'] = response['choices'][0].pop('message')
            return httpx.Response(200, headers={'content-type':'text/event-stream'},
                content='data: ' + json.dumps(response) + '\n\ndata: [DONE]\n\n')
        return httpx.Response(200, json=response)


def make_agent(AIAgent, provider, *, tools=True, max_iterations=3):
    import httpx
    from openai import OpenAI
    class ControlledAgent(AIAgent):
        # Pinned private client-construction seam: client replacement alone fails
        # because Hermes creates request-scoped clients and primary snapshots.
        def _create_openai_client(self, client_kwargs, *, reason, shared=False):
            return OpenAI(api_key='nonsecret-fixture-placeholder', base_url='http://fixture.invalid/v1',
                max_retries=0, http_client=httpx.Client(transport=httpx.MockTransport(provider.handle), trust_env=False))
    agent = ControlledAgent(model='bridge-deterministic', provider='custom', api_mode='chat_completions',
        api_key='nonsecret-fixture-placeholder', base_url='http://127.0.0.1:1/v1',
        enabled_toolsets=['workagent_broker'] if tools else [], max_iterations=max_iterations,
        quiet_mode=True, skip_context_files=True, skip_memory=True, skip_background_review=True,
        save_trajectories=False, session_db=None, fallback_model=None, run_budget_seconds=15)
    assert agent.valid_tool_names == ({'get_assignment'} if tools else set()), agent.valid_tool_names
    return agent


def text(value):
    return {'role':'assistant', 'content':value}


def tool(arguments, name='get_assignment', call_id='call-bridge'):
    return {'role':'assistant','content':None,'tool_calls':[
        {'id':call_id,'type':'function','function':{'name':name,'arguments':json.dumps(arguments)}}]}
